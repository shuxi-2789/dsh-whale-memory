// 索引卷生成器：扫全部记忆文件的〔符号〕标签，生成 关键词文件夹\索引卷.md
// （符号 → 出处/日期段对照表）。用法：node scripts/build-memory-index.mjs
// 大脑目录/代号/归档前缀来自 code/config.json，也可用 BRAIN_DIR / PERSONA /
// ARCHIVE_PREFIX 环境变量临时覆盖（拿别人的大脑跑一遍时不用改配置）。
// 桥接的每轮检索直接扫原文（不需要索引），这份索引是给她的「老流程」兜底
// 和主人审计用的。记忆更新后重跑一次即可（幂等，整个文件重写）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeywordTable, splitTaggedEntries, buildIndexDoc } from '../src/memory-scan-lib.mjs';
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

// 与 bridge.js collectMemoryFiles 同构：归档编号大 = 新（priority 高），根卷最老。
const files = [];
try {
  const tmpDir = path.join(brainDir, '临时文件夹');
  const dirs = fs.readdirSync(tmpDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name.trim(), no: parseArchive(d.name) }))
    .filter((x) => x.no != null)
    .sort((a, b) => b.no - a.no);
  for (const d of dirs) {
    const text = read(path.join(tmpDir, d.name, '备忘录.txt'));
    if (text) files.push({ source: `备忘录·${d.name}`, text, priority: d.no });
  }
} catch { /* 没有临时文件夹就算了 */ }
const rootText = read(path.join(brainDir, '根文件夹', '根记忆·总卷.txt'));
if (rootText) files.push({ source: '根记忆·总卷', text: rootText, priority: 0 });
// 时代卷：时代合并挪出去的旧周记原文存档（标签仍有效，索引要能找到出处）。
try {
  const eraDir = path.join(brainDir, '根文件夹', '时代卷');
  const eraFiles = fs.readdirSync(eraDir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.txt$/i.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  for (const name of eraFiles) {
    const text = read(path.join(eraDir, name));
    if (text) files.push({ source: `时代卷·${name.replace(/\.txt$/i, '')}`, text, priority: 0 });
  }
} catch { /* 没有时代卷目录就算了 */ }

if (!files.length) { console.error('没读到任何记忆文件（备忘录/根卷）'); process.exit(1); }

const doc = buildIndexDoc(files, table, brain.docOpts);
const out = path.join(brainDir, '关键词文件夹', '索引卷.md');
fs.writeFileSync(out, doc, 'utf8');
const entryCount = files.reduce((s, f) => s + splitTaggedEntries(f.source, f.text).length, 0);
console.log(`✓ 索引卷已生成：${out}`);
console.log(`  代号 ${brain.persona} · 归档前缀 ${JSON.stringify(brain.archivePrefix)} · 扫描 ${files.length} 个记忆文件，共 ${entryCount} 段带标签记忆，关键词表 ${table.words.length} 个词。`);
