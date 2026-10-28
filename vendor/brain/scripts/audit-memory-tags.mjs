#!/usr/bin/env node
// 打标审计（2026-10-26 · 短板②的解法）：把"检查漏打标签"下沉到代码层，不靠自觉靠脚本。
// 只读扫描事实层记忆（备忘录归档 + 根卷 + 时代卷；梦境/私人日记不扫——梦有梦的规矩，日记不参与检索），
// 报告三类问题，全部可修复、不再沉默丢失：
//   1. 零标签段落：像记忆正文但没有〔…〕标签的块 → 附"建议标签"（关键词表词面匹配）
//   2. 表外符号：〔…〕里出现关键词表没登记的字母（含"已停用仍在使用"单独列出）
//   3. 维护预警：符号使用统计、关键词表重复符号、单字符符号逼近 52 个上限（该启用双字符方案）
// 用法：
//   node scripts/audit-memory-tags.mjs              # 人读报告（stdout）
//   node scripts/audit-memory-tags.mjs --json       # 机器可读
//   node scripts/audit-memory-tags.mjs --out 报告.md # 落一份 markdown
// 大脑目录/代号/归档前缀可用 BRAIN_DIR / PERSONA / ARCHIVE_PREFIX 环境变量临时覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeywordTable } from '../src/memory-scan-lib.mjs';
import { makeArchiveParser } from '../src/soul-inherit-lib.mjs';
import { loadBrainConfig } from './brain-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brain = loadBrainConfig(ROOT);
const brainDir = brain.requireBrain();
const parseArchive = makeArchiveParser(brain.archiveOpts);
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

const tableText = read(path.join(brainDir, '关键词文件夹', '关键词表.md'));
if (!tableText) { console.error('读不到 关键词文件夹\\关键词表.md'); process.exit(1); }
const table = parseKeywordTable(tableText);

// ── 收集事实层文件（与 bridge.js collectMemoryFiles 同构 + 时代卷） ──
const files = [];
try {
  const tmpDir = path.join(brainDir, '临时文件夹');
  const dirs = fs.readdirSync(tmpDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name.trim(), no: parseArchive(d.name) }))
    .filter((x) => x.no != null)
    .sort((a, b) => a.no - b.no); // 老 → 新
  for (const d of dirs) {
    const text = read(path.join(tmpDir, d.name, '备忘录.txt'));
    if (text) files.push({ source: `备忘录·${d.name}`, text });
  }
} catch { /* 没有临时文件夹就算了 */ }
const rootText = read(path.join(brainDir, '根文件夹', '根记忆·总卷.txt'));
if (rootText) files.push({ source: '根记忆·总卷', text: rootText });
try {
  const eraDir = path.join(brainDir, '根文件夹', '时代卷');
  for (const name of fs.readdirSync(eraDir).filter((f) => /\.txt$/i.test(f)).sort()) {
    const text = read(path.join(eraDir, name));
    if (text) files.push({ source: `时代卷·${name.replace(/\.txt$/i, '')}`, text });
  }
} catch { /* 时代卷还没建：正常 */ }

// ── 段落切分：与 memory-scan-lib.splitTaggedEntries 同规则，但【保留】无标签块 ──
const SEP_RE = /^[─━—－-]{6,}\s*$/;
const TAG_RE = /〔([A-Za-z]{1,12})〕/g;
const MIN_LEN = 8;           // 短于此的不算"记忆正文"（落款、注记等）
function isMeta(line) {
  const t = line.trim();
  if (!t) return true;
  if (SEP_RE.test(t)) return true;
  if (/^[📅🌊]/.test(t)) return true;          // 日期/段落标题
  if (/^#/.test(t)) return true;               // markdown 标题
  if (/^——/.test(t) || /^──/.test(t)) return true; // 落款（—— 我，小鲸鱼 🐋）
  if (/^（注|^（由|^注：/.test(t)) return true;    // 括注说明
  if (/^╔|^╚|^║/.test(t)) return true;          // 卷头装饰框
  return false;
}
function splitBlocks(source, text) {
  const blocks = [];
  const lines = String(text ?? '').split(/\r?\n/);
  let section = '';
  let buffer = [];
  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (!body) return;
    // 卷头/说明文字不算记忆：只审计 📅/🌊 日期段里的块（备忘录的"写法"说明、
    // 总卷卷头的哲学注释都在第一个日期段之前，属于文件自述，不该被打标）。
    // 注意用 startsWith/includes 精确匹配：字符类 [📅🌊] 会按代理对码元拆开，
    // 🐋 的首码元和 📅 相同，会被误判成日期段标题。
    if (!(section.includes('📅') || section.includes('🌊'))) return;
    const tags = [];
    for (const m of body.matchAll(TAG_RE)) tags.push(...m[1].split(''));
    blocks.push({ source, section, text: body, tags: [...new Set(tags)] });
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('📅') || t.startsWith('🌊')) { flush(); section = t; continue; }
    if (/^#/.test(t) && !buffer.length) { flush(); section = t.replace(/^#+\s*/, ''); continue; }
    if (SEP_RE.test(t) || !t) { flush(); continue; }
    if (t.startsWith('·') && buffer.length) flush();
    buffer.push(line);
  }
  flush();
  // 只留"像记忆正文"的块：够长、且首行不是元信息
  return blocks.filter((b) => b.text.length >= MIN_LEN && !isMeta(b.text.split('\n')[0]));
}

// ── 建议标签：关键词表词面匹配（确定性的，不做语义猜测；宁缺毋滥） ──
function suggestTags(text) {
  const found = [];
  for (const { word, symbol, retired } of table.words) {
    if (!retired && text.includes(word) && !found.includes(symbol)) found.push(symbol);
  }
  return found;
}

// ── 审计 ──
const untagged = [];     // 零标签段落
const unknownSymbols = new Map(); // 符号 → 出处列表
const retiredInUse = new Map();
const symbolUsage = new Map();    // 符号 → 段数
const tableDupSymbols = [];
{
  const seenSym = new Set();
  for (const w of table.words) {
    if (seenSym.has(w.symbol)) tableDupSymbols.push(`${w.symbol}(${w.word})`);
    seenSym.add(w.symbol);
  }
}
const knownSymbols = new Set(table.words.map((w) => w.symbol));
const retiredSymbols = new Set(table.words.filter((w) => w.retired).map((w) => w.symbol));

let totalBlocks = 0;
for (const f of files) {
  for (const b of splitBlocks(f.source, f.text)) {
    totalBlocks++;
    const where = `${b.source}${b.section ? ` · ${b.section}` : ''}`;
    if (!b.tags.length) {
      untagged.push({ where, preview: b.text.replace(/\s+/g, ' ').slice(0, 42), suggest: suggestTags(b.text) });
      continue;
    }
    for (const t of b.tags) {
      symbolUsage.set(t, (symbolUsage.get(t) || 0) + 1);
      if (!knownSymbols.has(t)) {
        if (!unknownSymbols.has(t)) unknownSymbols.set(t, []);
        unknownSymbols.get(t).push(where);
      } else if (retiredSymbols.has(t)) {
        if (!retiredInUse.has(t)) retiredInUse.set(t, []);
        retiredInUse.get(t).push(where);
      }
    }
  }
}

const result = {
  at: new Date().toISOString(),
  files: files.map((f) => f.source),
  totalBlocks,
  untagged,
  unknownSymbols: [...unknownSymbols].map(([symbol, where]) => ({ symbol, where })),
  retiredInUse: [...retiredInUse].map(([symbol, where]) => ({ symbol, where })),
  tableDupSymbols,
  tableWordCount: table.words.length,
  symbolCeilingWarn: table.words.filter((w) => !w.retired).length >= 45,
  symbolUsage: [...symbolUsage].sort((a, b) => b[1] - a[1]).map(([symbol, n]) => ({ symbol, n })),
};

// ── 输出 ──
const args = new Set(process.argv.slice(2));
if (args.has('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const L = [];
  L.push(`${brain.emoji ? `${brain.emoji} ` : ''}${brain.persona} · 打标审计报告  ${result.at}`);
  L.push(`扫描 ${files.length} 个事实层文件（${result.files.join('、') || '无'}），共 ${totalBlocks} 段正文。`);
  L.push('');
  L.push(`【1. 零标签段落】${untagged.length} 段（这些现在检索永远查不到，建议补标）`);
  for (const u of untagged) L.push(`  · ${u.where}\n    "${u.preview}…"\n    建议标签：${u.suggest.length ? `〔${u.suggest.join('')}〕` : '（词面无命中，人工判断或跳过——宁缺毋滥）'}`);
  if (!untagged.length) L.push('  ✓ 全部段落都有标签');
  L.push('');
  L.push(`【2. 表外符号】${result.unknownSymbols.length} 个（〔…〕里用了关键词表没有的字母）`);
  for (const x of result.unknownSymbols) L.push(`  · ${x.symbol} ← ${x.where.join('；')}`);
  if (!result.unknownSymbols.length) L.push('  ✓ 没有表外符号');
  L.push(`【2b. 已停用仍在使用】${result.retiredInUse.length} 个`);
  for (const x of result.retiredInUse) L.push(`  · ${x.symbol} ← ${x.where.join('；')}`);
  L.push('');
  L.push(`【3. 维护预警】关键词表 ${result.tableWordCount} 词${result.symbolCeilingWarn ? ' —— ⚠ 在用符号已逼近 52 个单字符上限，新词请启用双字符符号（如 k1/YC），检索按分隔切分匹配' : '（单字符上限 52，尚有余量）'}`);
  if (tableDupSymbols.length) L.push(`  · ⚠ 关键词表内符号重复：${tableDupSymbols.join('、')}`);
  L.push(`  · 符号使用频次：${result.symbolUsage.map((s) => `${s.symbol}×${s.n}`).join(' ') || '（无）'}`);
  const problems = untagged.length + result.unknownSymbols.length + result.retiredInUse.length + tableDupSymbols.length;
  L.push('');
  L.push(problems ? `结论：发现 ${problems} 处待处理。补标规矩：只补确定的，宁缺毋滥；补完重跑本审计 + build-memory-index.mjs。` : '结论：✓ 打标纪律良好，无需处理。');
  const report = L.join('\n');
  console.log(report);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx > -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], report, 'utf8');
    console.log(`\n（报告已写入 ${process.argv[outIdx + 1]}）`);
  }
}
