#!/usr/bin/env node
// 手动钩子（L2 的退化方案）：宿主不给你"改唤醒提示词"的口子时，用这条命令把该塞的东西打出来，
// 你（或任何宿主的一条系统提示 / 一个定时任务）把它原样贴给她 —— 效果与桥接自动注入一致。
//
// 用法：
//   node code/scripts/wake-snapshot.mjs                      # 打印【灵魂快照】（新对话第一轮用）
//   node code/scripts/wake-snapshot.mjs --message "观众说的话"  # 追加【每轮相关回忆】三层块
//   node code/scripts/wake-snapshot.mjs --bootstrap --message "…" --out wake.txt
//   node code/scripts/wake-snapshot.mjs --recent recent.json # 追加【退役窗口补偿】块（recent.json = [{sender,text,time,isSelf}]）
//   加 --no-snapshot 只出检索块；加 --json 出机器可读结构。
//
// 三种接法（按你宿主的能刀程度选，见 README「宿主适配矩阵」）：
//   A 有钩子（桥接/自建 runner）：直接 import composeSoulSnapshot + buildRelevantMemoryLine，自动注入；
//   B 只有系统提示：把本命令的输出存成 wake.txt，每次开新对话前贴进系统提示（或让定时任务跑它）；
//   C 什么都没有：主人每天第一句话手动带上 —— L0 骨架 + 她自己按 记忆回溯模块.md 的口诀检索，仍然完整可用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrainConfig } from './brain-config.mjs';
import { composeSoulSnapshot, pickLatestArchive, lastSections, composeRecentChatLine, makeArchiveParser } from '../src/soul-inherit-lib.mjs';
import {
  parseKeywordTable, extractSignals, scanMemories, fuzzyScan, simhashScan,
  composeRelevantMemoryLine, composeAssociativeMemoryLine, composeSimhashMemoryLine, entryHash,
} from '../src/memory-scan-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const val = (name) => { const i = argv.indexOf(`--${name}`); return i > -1 ? argv[i + 1] : undefined; };
const brain = loadBrainConfig(ROOT);
const s = brain.soul;
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
if (!brain.brainDir || !fs.existsSync(brain.brainDir)) brain.requireBrain();

// ── 收集记忆（与 bridge.collectMemoryFiles / 各脚本同口径）──
const parseArchive = makeArchiveParser(brain.archiveOpts);
const files = [];
try {
  const tmpDir = path.join(brain.brainDir, '临时文件夹');
  const dirs = fs.readdirSync(tmpDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name.trim(), no: parseArchive(d.name) }))
    .filter((x) => x.no != null)
    .sort((a, b) => b.no - a.no);
  for (const d of dirs) {
    const text = read(path.join(tmpDir, d.name, '备忘录.txt'));
    if (text) files.push({ source: `备忘录·${d.name}`, text, priority: d.no });
  }
} catch { /* 没有临时文件夹 */ }

const rootText = read(path.join(brain.brainDir, '根文件夹', '根记忆·总卷.txt'));
if (rootText) files.push({ source: '根记忆·总卷', text: rootText, priority: 0 });
try {
  const eraDir = path.join(brain.brainDir, '根文件夹', '时代卷');
  for (const n of fs.readdirSync(eraDir).filter((f) => /\.txt$/i.test(f)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
    const text = read(path.join(eraDir, n));
    if (text) files.push({ source: `时代卷·${n.replace(/\.txt$/i, '')}`, text, priority: 0 });
  }
} catch { /* 还没时代合并 */ }

// ── ① 灵魂快照（bootstrap 一次）──
let snapshot = '';
if (!flag('no-snapshot')) {
  const diaryDir = brain.diaryDir;
  const diaryFile = [s.diaryFileName && path.join(diaryDir, String(s.diaryFileName)),
    path.join(diaryDir, `${brain.persona}的备忘录.txt`), path.join(diaryDir, '私人日记.txt')].filter(Boolean).find((p) => fs.existsSync(p));
  let memoArchive = ''; let memo = '';
  try {
    const dirs = fs.readdirSync(path.join(brain.brainDir, '临时文件夹'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    memoArchive = pickLatestArchive(dirs, brain.archiveOpts) ?? '';
    if (memoArchive) memo = read(path.join(brain.brainDir, '临时文件夹', memoArchive, '备忘录.txt'));
  } catch { /* 缺就缺，快照里会如实注明 */ }
  snapshot = composeSoulSnapshot({
    module: read(path.join(brain.brainDir, '记忆回溯模块.md')),
    root: rootText, memo, memoArchive,
    diary: diaryFile ? lastSections(read(diaryFile), 2) : '',
    agreement: read(path.join(diaryDir, '代录约定.txt')),
  }, Number(s.maxChars) > 0 ? Number(s.maxChars) : 20000, {
    persona: brain.persona,
    keepWeeks: Number.isFinite(Number(s.keepWeeks)) ? Number(s.keepWeeks) : 2,
    rootMaxChars: Number(s.rootMaxChars) > 0 ? Number(s.rootMaxChars) : undefined,
    moduleMaxChars: Number(s.moduleMaxChars) > 0 ? Number(s.moduleMaxChars) : undefined,
    unreadTool: val('unread-tool') ?? 'qq_get_unread_messages',
  });
}

// ── ② 退役窗口补偿（可选，给一个 json 就出）──
let recent = '';
const recentPath = val('recent');
if (recentPath) {
  try {
    const msgs = JSON.parse(read(recentPath));
    const rc = s.recentChat ?? {};
    recent = composeRecentChatLine(Array.isArray(msgs) ? msgs : [], {
      maxChars: Number(rc.maxChars) > 0 ? Number(rc.maxChars) : 1800,
      maxItems: Number(rc.maxItems) > 0 ? Number(rc.maxItems) : 40,
      windowHours: Number(rc.windowHours) > 0 ? Number(rc.windowHours) : 26,
      recentTool: val('recent-tool') ?? 'qq_get_recent_messages',
    });
  } catch (e) { console.error(`--recent 读取失败（${recentPath}）：${e?.message ?? e}`); }
}

// ── ③ 每轮相关回忆（给一条消息就扫一次）──
let retrieval = '';
const msg = val('message');
if (msg) {
  const table = parseKeywordTable(read(path.join(brain.brainDir, '关键词文件夹', '关键词表.md')));
  const pt = brain.perTurn;
  const sig = extractSignals(String(msg).slice(-600), table);
  const strongMatches = sig.strong.symbols.size ? scanMemories(files, sig.strong.symbols) : [];
  const strongLine = strongMatches.length ? composeRelevantMemoryLine(strongMatches, {
    maxItems: Number(pt.maxItems) > 0 ? Number(pt.maxItems) : 5,
    maxChars: Number(pt.maxChars) > 0 ? Number(pt.maxChars) : 1200,
    hits: sig.strong.hits,
  }) : '';
  const seen = new Set(strongMatches.map(entryHash));
  const sem = pt.semantic ?? {};
  let assocLine = '';
  if (!(sem.enabled === false)) {
    const semMaxItems = Number(sem.maxItems) > 0 ? Number(sem.maxItems) : 3;
    const aliasMatches = [];
    if (sig.weak.symbols.size) {
      for (const m of scanMemories(files, sig.weak.symbols)) {
        const h = entryHash(m); if (seen.has(h)) continue; seen.add(h);
        const via = sig.weak.hits.find((x) => Array.isArray(m.matched) && m.matched.includes(x.symbol));
        aliasMatches.push({ ...m, matchType: 'alias', via: via ? `${via.alias}→${via.word}` : '' });
      }
    }
    const fuzzyMatches = fuzzyScan(files, String(msg), { minScore: Number(sem.minScore) > 0 ? Number(sem.minScore) : 9 })
      .filter((m) => { const h = entryHash(m); if (seen.has(h)) return false; seen.add(h); return true; })
      .slice(0, semMaxItems).map((m) => ({ ...m, matchType: 'fuzzy' }));
    assocLine = composeAssociativeMemoryLine(aliasMatches.slice(0, semMaxItems), fuzzyMatches, {
      maxItems: semMaxItems, maxChars: Number(sem.maxChars) > 0 ? Number(sem.maxChars) : 600, aliasHits: sig.weak.hits,
    });
  }
  const sh = pt.simhash ?? {};
  let shLine = '';
  if (!(sh.enabled === false)) {
    const shMatches = simhashScan(files, String(msg), {
      maxDistance: Number.isFinite(Number(sh.maxDistance)) ? Number(sh.maxDistance) : 24,
      minGap: Number.isFinite(Number(sh.minGap)) ? Number(sh.minGap) : 4,
    }).filter((m) => { const h = entryHash(m); if (seen.has(h)) return false; seen.add(h); return true; });
    shLine = composeSimhashMemoryLine(shMatches.slice(0, Number(sh.maxItems) > 0 ? Number(sh.maxItems) : 2), {
      maxItems: Number(sh.maxItems) > 0 ? Number(sh.maxItems) : 2,
      maxChars: Number(sh.maxChars) > 0 ? Number(sh.maxChars) : 400,
    });
  }
  retrieval = [strongLine, assocLine, shLine].filter(Boolean).join('\n\n');
  if (!retrieval) console.error('（本次四层检索都没有命中 —— 这是正常结果：查不到就不注入，不硬塞回忆）');
}

const out = [
  snapshot,
  recent,
  retrieval,
].filter(Boolean).join('\n\n');
if (flag('json')) {
  console.log(JSON.stringify({ persona: brain.persona, files: files.map((f) => f.source), snapshotChars: snapshot.length, retrievalChars: retrieval.length, text: out }, null, 2));
} else if (out) {
  const target = val('out');
  if (target) { fs.writeFileSync(target, out, 'utf8'); console.error(`✓ 已写入 ${target}（${out.length} 字）—— 把它原样贴进她的系统提示/第一条消息前面。`); }
  else console.log(out);
} else {
  console.error('什么都没生成：检查 brainDir 是否存在（先跑 node code/scripts/doctor.mjs）。');
  process.exit(1);
}
