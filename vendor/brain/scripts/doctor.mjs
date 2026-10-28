#!/usr/bin/env node
// 环境体检（复刻第一步就该跑它）：把"装不上"的原因当场指出来，而不是让人对着报错猜。
// 用法：
//   node code/scripts/doctor.mjs              # 对着 code/config.json 配的那副大脑体检
//   node code/scripts/doctor.mjs --json       # 机器可读（给宿主 AI 看）
//   BRAIN_DIR=... PERSONA=... ARCHIVE_PREFIX=... node code/scripts/doctor.mjs
// 退出码：0 = 可以装 / 已经装好；1 = 有红灯项（下面会写清怎么修）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrainConfig } from './brain-config.mjs';
import { parseKeywordTable, extractSignals, scanMemories, fuzzyScan, extractFuzzyGrams, simhashScan, splitTaggedEntries, splitBlocks } from '../src/memory-scan-lib.mjs';
import { pickLatestArchive, makeArchiveParser, composeSoulSnapshot, lastSections } from '../src/soul-inherit-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_MODE = process.argv.includes('--json');
const MIN_NODE = 20;
const results = [];
const add = (level, item, detail, fix) => results.push({ level, item, detail, fix: fix ?? '' });

// ── 1. node 本体（最常见的第一个卡点：PATH 上没有 node）──
{
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= MIN_NODE ? 'ok' : 'fail', `Node 版本 ${process.versions.node}`,
    `解释器：${process.execPath}`,
    major >= MIN_NODE ? '' : '装 Node ≥20（https://nodejs.org），或直接用宿主的 runtime：'
      + 'DSH 在 %USERPROFILE%\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe；'
      + '拿到绝对路径后，把后面所有命令里的 node 换成它。');
  if (!process.env.DSH_NODE_HINT) {
    const onPath = (() => {
      try {
        const dirs = String(process.env.PATH ?? '').split(path.delimiter);
        return dirs.some((d) => d && fs.existsSync(path.join(d, process.platform === 'win32' ? 'node.exe' : 'node')));
      } catch { return false; }
    })();
    add(onPath ? 'ok' : 'warn', 'PATH 里能不能直接敲 node',
      onPath ? '可以，命令照抄即可' : '不行：必须用 node 的绝对路径跑本套件的脚本',
      onPath ? '' : 'PowerShell 里可临时 $node="…\\node.exe"，然后 & $node code\\scripts\\doctor.mjs；或把该目录加进 PATH。');
  }
}

// ── 2. 配置 ──
const brain = loadBrainConfig(ROOT);
add(fs.existsSync(path.join(ROOT, 'config.json')) ? 'ok' : 'warn', '配置文件 code/config.json',
  `代号=${brain.persona} 归档前缀=${JSON.stringify(brain.archivePrefix)} brainDir=${brain.brainDir || '(未配置)'}`,
  '相对路径按 code/ 解析；换大脑目录改 brainDir，或临时用环境变量 BRAIN_DIR。');
const brainOk = brain.brainDir && fs.existsSync(brain.brainDir);
add(brainOk ? 'ok' : 'fail', '大脑目录存在', brain.brainDir || '(未配置)',
  brainOk ? '' : '先跑 L0：复制 brain-template\\ 到你的桌面，并把 config.json 的 brainDir 指过去。');
if (!brainOk) { report(); process.exit(1); }

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
// ── 3. 五件套齐不齐 ──
const parts = [
  ['记忆回溯模块.md', path.join(brain.brainDir, '记忆回溯模块.md')],
  ['关键词表.md', path.join(brain.brainDir, '关键词文件夹', '关键词表.md')],
  ['根记忆·总卷.txt', path.join(brain.brainDir, '根文件夹', '根记忆·总卷.txt')],
  ['梦境日记.txt', path.join(brain.brainDir, '梦境文件夹', '梦境日记.txt')],
];
for (const [name, p] of parts) {
  const ok = fs.existsSync(p) && read(p).trim().length > 0;
  add(ok ? 'ok' : 'warn', `骨架文件 ${name}`, ok ? `${Math.round(fs.statSync(p).size / 102.4) / 10} KB` : '缺失或空',
    ok ? '' : `从 brain-template\\ 里补一份，或按 记忆回溯模块.md 的树自己建：${p}`);
}

// ── 4. 归档前缀认不认得出（换代号的人最容易踩空的一步）──
const tmpDir = path.join(brain.brainDir, '临时文件夹');
let archiveDirs = [];
try { archiveDirs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* 没有 */ }
const parse = makeArchiveParser(brain.archiveOpts);
const matched = archiveDirs.filter((d) => parse(d) != null);
add(matched.length ? 'ok' : 'fail', '近期归档目录（备忘录所在）',
  matched.length ? `前缀 ${JSON.stringify(brain.archivePrefix)} 认出 ${matched.join('、')}（共 ${archiveDirs.length} 个目录）`
    : `一个都没认出（目录有：${archiveDirs.join('、') || '无'}）`,
  matched.length ? '' : '把 config.json 的 archivePrefix 改成你归档目录名的前缀（例如 "归档"、"卷宗"）；填 "" 表示"任意名字只要结尾是编号"。');
const latest = pickLatestArchive(archiveDirs, brain.archiveOpts);
const memoFile = latest ? path.join(tmpDir, latest, '备忘录.txt') : '';
if (memoFile) add(fs.existsSync(memoFile) ? 'ok' : 'warn', `当前归档的备忘录.txt`, memoFile, fs.existsSync(memoFile) ? '' : '文件名必须是 备忘录.txt');

// ── 5. 码本健康度 ──
const table = parseKeywordTable(read(path.join(brain.brainDir, '关键词文件夹', '关键词表.md')));
const live = table.words.filter((w) => !w.retired);
const dup = new Set(); const seenSym = new Set();
for (const w of table.words) { if (seenSym.has(w.symbol)) dup.add(w.symbol); seenSym.add(w.symbol); }
add(live.length && live.length <= 45 ? 'ok' : 'warn', `关键词表 ${table.words.length} 词（在用 ${live.length} 个符号）`,
  `单字符符号上限约 52，去掉形近余量不多`, live.length > 45 ? '启用双字符符号（如 k1/YC）或停用低频词——别删行，标（停用）。' : '');
if (dup.size) add('warn', '关键词表里有重复符号', [...dup].join(' '), '一个符号只能分给一个词，永远不换。');
const files = [];
if (matched.length) {
  for (const name of archiveDirs.filter((d) => parse(d) != null).sort((a, b) => parse(b) - parse(a))) {
    const t = read(path.join(tmpDir, name, '备忘录.txt'));
    if (t) files.push({ source: `备忘录·${name}`, text: t, priority: parse(name) });
  }
}
const rootText = read(path.join(brain.brainDir, '根文件夹', '根记忆·总卷.txt'));
if (rootText) files.push({ source: '根记忆·总卷', text: rootText, priority: 0 });
try {
  for (const n of fs.readdirSync(path.join(brain.brainDir, '根文件夹', '时代卷')).filter((f) => /\.txt$/i.test(f))) {
    const t = read(path.join(brain.brainDir, '根文件夹', '时代卷', n));
    if (t) files.push({ source: `时代卷·${n.replace(/\.txt$/i, '')}`, text: t, priority: 0 });
  }
} catch { /* 还没时代合并 */ }
const entries = files.flatMap((f) => splitTaggedEntries(f.source, f.text));
const blocks = files.flatMap((f) => splitBlocks(f.source, f.text));
const unknown = [...new Set(entries.flatMap((e) => e.tags))].filter((t) => !table.bySymbol.has(t));
add(entries.length ? 'ok' : 'warn', `带标签记忆 ${entries.length} 段 / 全部段落 ${blocks.length} 块`,
  entries.length ? '' : '一段带〔标签〕的记忆都还没有', entries.length ? '' : '先让她写一晚备忘录（routines\\diary-night.md），或手动补几段带〔…〕的示例。');
if (unknown.length) add('warn', '段里出现表外符号', unknown.join(' '), '要么补进关键词表，要么改回来——否则这些标签检索时查不到。');

// ── 6. 四层检索能不能真出东西（探针全部从真实记忆里导出，与 test-memory-scan 同思路）──
const probeWord = live.find((w) => entries.some((e) => e.tags.includes(w.symbol)))?.word;
const perTurn = brain.perTurn;
const clean = (t) => String(t ?? '').replace(/〔[A-Za-z]*〕/g, '').trim();
const longBlocks = blocks.filter((b) => b.text.length >= 16).sort((a, b) => b.text.length - a.text.length);
if (probeWord) {
  const sig = extractSignals(`还记得关于${probeWord}的事吗`, table);
  const strong = scanMemories(files, sig.strong.symbols);
  add(strong.length ? 'ok' : 'warn', `① 强关键词层（探针词「${probeWord}」）`, `命中 ${strong.length} 段`, strong.length ? '' : '检查标签是否真含该符号。');
} else add('warn', '① 强关键词层', '表里没有任何一个词能在记忆标签里找到', '先让她写一晚备忘录（routines\\diary-night.md），或跑 auto-tag-memory.mjs 补标。');
const sem = perTurn.semantic ?? {};
const gram = (longBlocks[0] ? extractFuzzyGrams(clean(longBlocks[0].text)) : []).find((g) => g.length >= 3);
if (gram) {
  const fz = fuzzyScan(files, gram, { minScore: Number(sem.minScore) > 0 ? Number(sem.minScore) : 9 });
  add(fz.length ? 'ok' : 'warn', `②③ 联想层（探针特征词「${gram}」）`, `字面模糊命中 ${fz.length} 段`,
    fz.length ? '' : '库太小或全是泛词时属正常；等记忆多了再看这一层。');
} else add('info', '②③ 联想层', '段落里导不出 ≥3 字特征词（库还太小），跳过');
const shCfg = perTurn.simhash ?? {};
const shQuery = longBlocks[0] ? clean(longBlocks[0].text).slice(0, 30) : '';
if (shQuery) {
  const sh = simhashScan(files, shQuery, { maxDistance: Number(shCfg.maxDistance) > 0 ? Number(shCfg.maxDistance) : 24 });
  add(sh.length ? 'ok' : 'warn', '④ 指纹层（拿最长段落的前 30 字查它自己）',
    sh.length ? `命中 ${sh.length} 段，最近距离 ${sh[0].distance}/64（阈值 ${Number(shCfg.maxDistance) > 0 ? Number(shCfg.maxDistance) : 24}）` : '一段都没命中 —— 段落太短或阈值太紧',
    sh.length ? '' : '记忆再多一些再看；或用 probe-simhash.mjs 看距离分布再调 maxDistance。');
} else add('info', '④ 指纹层', '没有 ≥16 字的段落可算指纹，跳过');

// ── 7. 醒来快照装不装得下 ──
const diaryDir = brain.diaryDir;
const diaryFile = [brain.soul.diaryFileName && path.join(diaryDir, String(brain.soul.diaryFileName)),
  path.join(diaryDir, `${brain.persona}的备忘录.txt`), path.join(diaryDir, '私人日记.txt')].filter(Boolean).find((p) => fs.existsSync(p));
const snap = composeSoulSnapshot({
  module: read(path.join(brain.brainDir, '记忆回溯模块.md')),
  root: rootText,
  memo: memoFile ? read(memoFile) : '', memoArchive: latest ?? '',
  diary: diaryFile ? lastSections(read(diaryFile), 2) : '',
  agreement: read(path.join(diaryDir, '代录约定.txt')),
}, Number(brain.soul.maxChars) > 0 ? Number(brain.soul.maxChars) : 20000,
{ persona: brain.persona, keepWeeks: Number.isFinite(Number(brain.soul.keepWeeks)) ? Number(brain.soul.keepWeeks) : 2 });
add(snap.length <= (Number(brain.soul.maxChars) || 20000) + 1500 ? 'ok' : 'fail', '灵魂快照体积',
  `${snap.length} 字（预算 ${brain.soul.maxChars ?? 20000}）`, snap.length > 21500 ? '调小 rootMaxChars / moduleMaxChars，或做时代合并。' : '');

// ── 8. 下一步命令 ──
add('info', '接着跑这三条验收', [
  'node code/tests/test-soul-inherit.mjs',
  'node code/tests/test-memory-scan.mjs',
  'node code/tests/test-diary-lib.mjs',
].join('   '));

function report() {
  if (JSON_MODE) { console.log(JSON.stringify({ ok: !results.some((r) => r.level === 'fail'), results }, null, 2)); return; }
  const icon = { ok: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };
  console.log(`\n🩺 记忆系统环境体检 · 代号 ${brain.persona} · ${new Date().toLocaleString('zh-CN')}\n`);
  for (const r of results) {
    console.log(`${icon[r.level]} ${r.item}`);
    if (r.detail) console.log(`     ${r.detail}`);
    if (r.fix) console.log(`     → ${r.fix}`);
  }
  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log(`\n结论：${fails ? `${fails} 项红灯，先按上面的 → 修` : warns ? `${warns} 项提醒，可以先跑起来再补` : '全绿，可以装 / 已经装好'}。`);
}
report();
process.exit(results.some((r) => r.level === 'fail') ? 1 : 0);
