#!/usr/bin/env node
// SimHash 阈值探针：拿真实大脑目录量「消息 ↔ 记忆块」的汉明距离分布，
// 给 perTurn.simhash.maxDistance 调参用（观察期工具，不参与线上逻辑）。
// 用法：
//   node scripts/probe-simhash.mjs "要试的消息文本"
//   node scripts/probe-simhash.mjs            # 用几条内置样例消息
//   BRAIN_DIR=... node scripts/probe-simhash.mjs ...   # 换一副大脑试，不改配置
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitBlocks, simhash, hammingDistance } from '../src/memory-scan-lib.mjs';
import { loadBrainConfig } from './brain-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brainDir = loadBrainConfig(ROOT).requireBrain();

// 与 bridge.js collectMemoryFiles 同口径（备忘录归档 + 根卷 + 时代卷）
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const files = [];
try {
  const tmpDir = path.join(brainDir, '临时文件夹');
  for (const d of fs.readdirSync(tmpDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const text = read(path.join(tmpDir, d.name, '备忘录.txt'));
    if (text) files.push({ source: `备忘录·${d.name}`, text });
  }
} catch { /* 无临时文件夹 */ }
const rootText = read(path.join(brainDir, '根文件夹', '根记忆·总卷.txt'));
if (rootText) files.push({ source: '根记忆·总卷', text: rootText });
try {
  const eraDir = path.join(brainDir, '根文件夹', '时代卷');
  for (const d of fs.readdirSync(eraDir, { withFileTypes: true }).filter((x) => x.isFile() && /\.txt$/i.test(x.name))) {
    const text = read(path.join(eraDir, d.name));
    if (text) files.push({ source: `时代卷·${d.name.replace(/\.txt$/i, '')}`, text });
  }
} catch { /* 无时代卷 */ }

const blocks = [];
for (const f of files) {
  for (const b of splitBlocks(f.source, f.text)) {
    if (b.text.length < 12) continue;
    const fp = simhash(b.text);
    if (fp !== null) blocks.push({ ...b, fp });
  }
}
console.log(`记忆块（可算指纹）：${blocks.length} 段，来自 ${files.length} 个文件`);

const queries = process.argv.slice(2).join(' ').trim()
  ? [process.argv.slice(2).join(' ')]
  : [
      '主人还记得唱歌和白饭的约定吗，好开心啊',
      '还记得去年夏天吗',
      '今天主人夸我了',
      '我们聊过雪地挥拳的事情吗',
    ];

for (const q of queries) {
  const qfp = simhash(q);
  if (qfp === null) { console.log(`\n「${q}」→ 特征太少，不出指纹`); continue; }
  const ranked = blocks
    .map((b) => ({ b, d: hammingDistance(qfp, b.fp) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 5);
  console.log(`\n「${q}」最近 5 段：`);
  for (const { b, d } of ranked) {
    console.log(`  d=${String(d).padStart(2)}  ${b.source}${b.section ? ` · ${b.section}` : ''}  ${b.text.replace(/\s+/g, ' ').slice(0, 42)}`);
  }
  const dists = blocks.map((b) => hammingDistance(qfp, b.fp)).sort((a, b) => a - b);
  const pct = (p) => dists[Math.min(dists.length - 1, Math.floor(dists.length * p))];
  console.log(`  分布：min=${dists[0]} p10=${pct(0.1)} p50=${pct(0.5)} max=${dists[dists.length - 1]}`);
}
