#!/usr/bin/env node
// 自动补标（2026-10-26 · 打标单点依赖的机制化补偿）
// ============================================================================
// 问题：每轮标签检索的命中率建立在「每段记忆都打了〔标签〕」之上，而打标靠
// 每晚 22:30 的自觉——漏一晚，那段记忆就在符号检索里「隐身」。
// 本脚本是代码级安全网：扫描 备忘录（全部归档）+ 根记忆·总卷，找出**没打标签
// 的事件句**，用关键词表（含含义列近义词）定标，把〔符号串〕原行补写回去。
//
// 规矩（与 memory-scan-lib 红线一致）：
//   · 只**追加**标签，永不改写/删除任何原文；已有标签的块一律不碰；
//   · 定不出符号的块保持原样并如实报告（宁缺毋滥，不硬打）；
//   · 写回前给每个被改的文件留 .pre-autotag.bak（只留第一次，不被覆盖）；
//   · 时代卷默认不碰（存档原文保持原样），--include-era 才处理；
//   · 私人日记永不扫描；
//   · 改完自动重跑 build-memory-index.mjs，索引卷与原文保持一致。
//
// 用法：
//   node scripts/auto-tag-memory.mjs           # 实际补标（每日计划任务 WhaleAutoTag 23:15）
//   node scripts/auto-tag-memory.mjs --dry     # 只报告不写回
//   node scripts/auto-tag-memory.mjs --include-era
// 大脑目录/代号可用 BRAIN_DIR / PERSONA / ARCHIVE_PREFIX 环境变量临时覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseKeywordTable, splitBlocks, suggestTags, looksLikeEventBlock, mineCandidateWords, composeCandidateWordsDoc } from '../src/memory-scan-lib.mjs';
import { loadBrainConfig } from './brain-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const INCLUDE_ERA = process.argv.includes('--include-era');

const brain = loadBrainConfig(ROOT);
const brainDir = brain.requireBrain();

const tableText = (() => { try { return fs.readFileSync(path.join(brainDir, '关键词文件夹', '关键词表.md'), 'utf8'); } catch { return ''; } })();
if (!tableText) { console.error('关键词表.md 读不到，无法定标'); process.exit(1); }
const table = parseKeywordTable(tableText);

// 收集目标文件：临时文件夹全部归档备忘录（新在前）+ 根卷（+ 可选时代卷）
const targets = [];
try {
  const tmpDir = path.join(brainDir, '临时文件夹');
  const dirs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const name of dirs) {
    const p = path.join(tmpDir, name, '备忘录.txt');
    if (fs.existsSync(p)) targets.push(p);
  }
} catch { /* 临时文件夹不存在 */ }
const rootFile = path.join(brainDir, '根文件夹', '根记忆·总卷.txt');
if (fs.existsSync(rootFile)) targets.push(rootFile);
if (INCLUDE_ERA) {
  try {
    const eraDir = path.join(brainDir, '根文件夹', '时代卷');
    for (const d of fs.readdirSync(eraDir, { withFileTypes: true })) {
      if (d.isFile() && /\.txt$/i.test(d.name)) targets.push(path.join(eraDir, d.name));
    }
  } catch { /* 时代卷还没建 */ }
}

let totalTagged = 0; let totalSkipped = 0; let filesChanged = 0;
const untaggedEvents = []; // 码本自动生长的原料：全部未打标签的事件句（含定得出符号的）
for (const file of targets) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const blocks = splitBlocks(path.basename(file), raw);
  const pending = []; // { endLine, symbols, preview }
  for (const b of blocks) {
    if (b.tagged) continue;
    if (!looksLikeEventBlock(b.text)) continue; // 标题/结构说明/卷头不碰
    untaggedEvents.push(b);
    const symbols = suggestTags(b.text, table);
    if (!symbols) { totalSkipped++; continue; } // 定不出符号：保持原样
    pending.push({ endLine: b.endLine, symbols, preview: b.text.replace(/\s+/g, ' ').slice(0, 40) });
  }
  const rel = path.relative(brainDir, file);
  if (!pending.length) { console.log(`· ${rel}：无需补标`); continue; }
  for (const p of pending) {
    // 同一行可能被多个块指到（理论上不会），追加即可；行尾已有〔…〕的跳过
    if (/〔[A-Za-z]{1,12}〕\s*$/.test(lines[p.endLine])) continue;
    lines[p.endLine] = `${lines[p.endLine].replace(/\s+$/, '')}〔${p.symbols}〕`;
  }
  totalTagged += pending.length;
  console.log(`${DRY ? '[dry] ' : ''}✍ ${rel}：补标 ${pending.length} 段`);
  for (const p of pending) console.log(`    〔${p.symbols}〕 ${p.preview}`);
  if (!DRY) {
    const bak = `${file}.pre-autotag.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); // 只留第一次的原样备份
    fs.writeFileSync(file, lines.join(eol), 'utf8');
    filesChanged++;
  }
}

console.log(`\n结果：补标 ${totalTagged} 段，定不出符号保持原样 ${totalSkipped} 段，改动文件 ${filesChanged} 个${DRY ? '（dry-run，未写回）' : ''}。`);

// ── 码本自动生长（2026-10-26 深夜 ⑧）──────────────────────────────────────
// 从全部未打标签的事件句里挖「关键词表定不出符号」的高频特征词，生成
// 关键词文件夹\候选新词清单.md —— 清单不直接生效：桥接会把它注入她的晚间
// 作息（{{CANDIDATE_WORDS}}），由她过目决定收编哪些词，再走关键词表
// 「自己增减」规矩由主人/桌面助手分配符号写表。检测自动化，语义判断留给她。
try {
  const candidates = mineCandidateWords(untaggedEvents, table, {});
  const doc = composeCandidateWordsDoc(candidates, brain.docOpts);
  const kwDir = path.join(brainDir, '关键词文件夹');
  fs.mkdirSync(kwDir, { recursive: true });
  const listFile = path.join(kwDir, '候选新词清单.md');
  if (!DRY) fs.writeFileSync(listFile, doc, 'utf8');
  console.log(`码本生长：候选新词 ${candidates.length} 个${DRY ? '（dry-run，未写清单）' : ` → ${path.relative(brainDir, listFile)}`}`);
  for (const c of candidates) console.log(`    ${c.word} ×${c.df}  例：${c.example}`);
} catch (error) {
  console.error(`⚠ 候选新词挖掘失败（不影响补标结果）: ${error?.message ?? error}`);
}

if (!DRY && filesChanged > 0) {
  console.log('重跑索引卷…');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-memory-index.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) console.error('⚠ 索引卷重建失败，请手动跑 npm run build:memory-index');
}
process.exit(0);
