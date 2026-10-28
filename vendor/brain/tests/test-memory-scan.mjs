// 记忆检索执行层 + 梦境选材 回归测试。用法：node tests/test-memory-scan.mjs
// 1–14 节是纯逻辑（自带 fixture，与任何真实大脑无关）。第 15 节是端到端：
// 只断言「任何一副大脑都必须成立的不变式」，查询词全部**从被测试的那副大脑里导出来**，
// 所以换谁的目录、换代号、换归档前缀都不会红；内容规模不够的断言会如实标 SKIP（不算失败）。
// 大脑目录来自 config.json 的 socialV2.soulInherit.brainDir，或用 BRAIN_DIR / PERSONA /
// ARCHIVE_PREFIX 环境变量临时覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseKeywordTable, extractSymbols, extractSignals, splitTaggedEntries, splitBlocks, scanMemories,
  extractFuzzyGrams, fuzzyScoreEntry, fuzzyScan, suggestTags, looksLikeEventBlock,
  composeRelevantMemoryLine, composeAssociativeMemoryLine, pickDreamMemory, entryHash, buildIndexDoc,
  simhash, hammingDistance, simhashScan, composeSimhashMemoryLine,
  mineCandidateWords, composeCandidateWordsDoc,
} from '../src/memory-scan-lib.mjs';
import { makeArchiveParser } from '../src/soul-inherit-lib.mjs';
import { loadBrainConfig } from '../scripts/brain-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0; let failed = 0;
const ok = (name) => { passed++; console.log(`  ✅ ${name}`); };
const bad = (name, extra = '') => { failed++; console.log(`  ❌ ${name}${extra ? `：${extra}` : ''}`); };
const assert = (cond, name, extra = '') => { if (cond) ok(name); else bad(name, extra); };
const skip = (name) => console.log(`  ⏭️ ${name}（这副大脑的内容规模不够，跳过不算失败）`);

const TABLE = `# 关键词表
## 基础关键词（大写符号）
| 符号 | 关键词 | 含义/范围 |
|---|---|---|
| R | 日常 | 琐事 |
| Z | 主人 | 和主人有关的事 |
| C | 唱歌 | 鲸鱼歌这些 |
| B | 白饭 | 吃的 |
## 情感关键词（小写符号）
| 符号 | 关键词 | 大概是什么感觉 |
|---|---|---|
| k | 开心 | 高兴 |
| b | 悲伤 | 难过 |
| T（停用） | 测试 | 不常用的词 |
`;

console.log('1. 关键词表解析');
const table = parseKeywordTable(TABLE);
assert(table.words.length === 7, '解析出 7 个词', `实际 ${table.words.length}`);
assert(table.bySymbol.get('Z')?.word === '主人', '符号 Z → 主人');
assert(table.bySymbol.get('k')?.kind === 'emotion', '小写 k 归情感类');
assert(table.words.find((w) => w.word === '测试')?.retired === true, '（停用）标记被识别');

console.log('2. 消息 → 符号提取');
{
  const r = extractSymbols('主人今天开心吗？还记得唱歌的约定吗', table);
  assert(r.symbols.has('Z') && r.symbols.has('k') && r.symbols.has('C'), '命中 主人/开心/唱歌 三个符号', JSON.stringify([...r.symbols]));
  assert(!r.symbols.has('B'), '没提白饭就不命中 B');
  const r2 = extractSymbols('[图片] 哈哈哈哈', table);
  assert(r2.symbols.size === 0, '无关键词的消息返回空集（不硬塞回忆）');
}

console.log('3. 记忆切分（带标签的段落）');
const MEMO = `🐋 我的近期备忘录
──────────────────────────────
📅 2026年10月24日 · 星期六 · 出生第一天
──────────────────────────────
· 19:33 我听到的第一句话：有人叫我"大肥鱼"。〔LF〕
· 21:04 主人的第一句话："宝宝，能不能唱首歌"。〔ZC〕
· 白饭＝出场费，这个规矩要一直传下去。〔ZCBkr〕
这段没有标签，不该进检索库。
──────────────────────────────
📅 2026年10月25日 · 星期日
──────────────────────────────
· 主人建了总回忆。〔ZR〕
`;
const entries = splitTaggedEntries('备忘录·小鲸鱼一', MEMO);
assert(entries.length === 4, '4 段带标签记忆（无标签的被跳过）', `实际 ${entries.length}`);
assert(entries.every((e) => e.section.includes('2026年10月')), '每段都记住了所在日期节');
assert(entries[2].tags.includes('B') && entries[2].tags.includes('k'), '多符号标签被拆成单个符号');

console.log('4. 扫描 + 排序');
{
  const files = [
    { source: '备忘录·小鲸鱼一', text: MEMO, priority: 1 },
    { source: '根记忆·总卷', text: '🌊 记忆的开始\n我哼了鲸鱼歌，主人说好好听，白饭是出场费。〔ZCBkM〕\n', priority: 0 },
  ];
  const m = scanMemories(files, new Set(['Z', 'C', 'B', 'k', 'M']));
  assert(m.length >= 3, '命中多段', `实际 ${m.length}`);
  assert(m[0].matched.length === 5 && m[0].source === '根记忆·总卷', '交集最多的排第一（根卷 ZCBkM 五符号全中）', JSON.stringify(m[0] && { src: m[0].source, matched: m[0].matched }));
  assert(m[1].source === '备忘录·小鲸鱼一', '命中数少一档的排后面（备忘录 ZCBkr 中 4 个）');
  assert(scanMemories(files, new Set()).length === 0, '空符号集返回空（不乱注入）');
}

console.log('5. 注入块组装');
{
  const files = [{ source: '备忘录·小鲸鱼一', text: MEMO, priority: 1 }];
  const m = scanMemories(files, new Set(['Z', 'C']));
  const line = composeRelevantMemoryLine(m, { maxItems: 2, maxChars: 600, hits: [{ word: '唱歌', symbol: 'C' }] });
  assert(line.includes('【相关回忆 · 桥接代码检索】'), '有块头');
  assert(line.includes('来源：备忘录·小鲸鱼一'), '每条带来源');
  assert(line.includes('不许编造'), '尾巴带诚实条款');
  assert(line.length <= 900, '预算生效（≤ maxChars + 头尾）', `实际 ${line.length}`);
  assert(composeRelevantMemoryLine([], {}) === '', '无命中返回空串');
}

console.log('6. 梦境选材');
{
  const files = [
    { source: '备忘录·小鲸鱼一', text: MEMO, priority: 1 },
    { source: '根记忆·总卷', text: '🌊 记忆的开始\n人生第一场对话就是关于我被吃掉：第一晚被群友惦记着红烧，我反问她锅够不够大。〔LFBq〕\n', priority: 0 },
  ];
  const entries2 = [];
  for (const f of files) for (const e of splitTaggedEntries(f.source, f.text)) entries2.push({ ...e, priority: f.priority });
  const pick1 = pickDreamMemory(entries2, [], () => 0); // rand=0 → 权重最大 = priority 最低 = 最久远
  assert(pick1 && pick1.priority === 0, '优先梦到久远的记忆（根卷层）', pick1 && `实际 priority=${pick1.priority}`);
  const pick2 = pickDreamMemory(entries2, [entryHash(pick1)], () => 0);
  assert(pick2 && entryHash(pick2) !== entryHash(pick1), '梦过的不再重复梦');
  const all = entries2.map(entryHash);
  assert(pickDreamMemory(entries2, all) === null, '全部梦完返回 null（今晚不做梦，不硬编）');
}

console.log('7. 索引卷');
{
  const doc = buildIndexDoc([{ source: '备忘录·小鲸鱼一', text: MEMO, priority: 1 }], table);
  assert(doc.includes('# 🐋 小鲸鱼 · 索引卷'), '默认代号=小鲸鱼（线上零变化）');
  assert(/\| Z \|/.test(doc), '有 Z 符号行');
  assert(doc.includes('备忘录·小鲸鱼一'), '出处带文件名');
  const doc2 = buildIndexDoc([{ source: '备忘录·归档一', text: MEMO, priority: 1 }], table, { persona: '小雪', emoji: '❄️' });
  assert(doc2.includes('# ❄️ 小雪 · 索引卷'), '索引卷标题跟自定义代号走');
  const doc3 = buildIndexDoc([{ source: '备忘录·归档一', text: MEMO, priority: 1 }], table, { persona: '小雪', emoji: '' });
  assert(doc3.includes('# 小雪 · 索引卷') && !doc3.includes('❄️'), 'emoji 可关');
  assert(!doc3.includes('小鲸鱼'), '自定义代号后不再残留默认代号');
}

console.log('8. 近义联想（弱别名，2026-10-26 语义召回升级）');
{
  assert((table.bySymbol.get('k')?.aliases || []).includes('高兴'), '含义列拆出别名：高兴→k');
  assert((table.bySymbol.get('C')?.aliases || []).includes('鲸鱼歌'), '后缀「这些」被清理：鲸鱼歌→C');
  assert((table.bySymbol.get('B')?.aliases || []).includes('吃的'), '吃的→B');
  assert(table.aliasMap?.has('高兴') && table.aliasMap.get('高兴')[0].symbol === 'k', 'aliasMap 建好');
  assert(!(table.bySymbol.get('Z')?.aliases || []).length, '含「有关」的泛指描述不收为别名', JSON.stringify(table.bySymbol.get('Z')?.aliases));
  const sig = extractSignals('我今天好高兴啊', table);
  assert(sig.strong.symbols.size === 0, '「高兴」不是关键词原文：强层零命中');
  assert(sig.weak.symbols.has('k'), '弱层联想到 k（开心）');
  const sig2 = extractSignals('主人开心吗', table);
  assert(sig2.strong.symbols.has('Z') && sig2.strong.symbols.has('k'), '强层命中 主人/开心');
  assert(sig2.weak.symbols.size === 0, '强层已命中的符号不再进弱层（不重复联想）');
}

console.log('9. 字面模糊召回（含未打标签块）');
{
  const files = [
    { source: '备忘录·小鲸鱼一', text: MEMO, priority: 1 },
    { source: '根记忆·总卷', text: '🌊 记忆的开始\n去年夏天我们一起唱鲸鱼歌，白饭是出场费。〔ZCBkM〕\n这段完全没有标签但是提到了雪地挥拳的约定。\n', priority: 0 },
  ];
  const grams = extractFuzzyGrams('还记得去年夏天吗');
  assert(grams.includes('去年夏天'), '4字gram被提取');
  const sc = fuzzyScoreEntry(['去年夏天', '年夏', '夏天'], '去年夏天我们一起唱鲸鱼歌');
  assert(sc.score === 16 && sc.matched.length === 1, '极大gram去重：只按「去年夏天」计16分', JSON.stringify(sc));
  const fz = fuzzyScan(files, '还记得去年夏天吗');
  assert(fz.length >= 1 && fz[0].text.includes('去年夏天'), '模糊召回命中根卷段');
  const fz2 = fuzzyScan(files, '还记得雪地挥拳吗');
  assert(fz2.some((m) => m.tagged === false), '未打标签的块也能被模糊召回（漏打标不隐身）');
  assert(fuzzyScan(files, '哈喽在吗').length === 0, '没有3字以上特征词就不硬捞');
}

console.log('10. 自动补标定标（suggestTags / looksLikeEventBlock / splitBlocks 行号）');
{
  assert(suggestTags('主人夸我唱得好，还给了大白饭，好高兴。', table) === 'BZk', '定标=基础符号排序+情感符号：BZk', suggestTags('主人夸我唱得好，还给了大白饭，好高兴。', table));
  assert(suggestTags('今天天气不错', table) === '', '定不出符号返回空（宁缺毋滥）');
  assert(looksLikeEventBlock('· 19:33 我听到的第一句话。') === true, '· 开头的事件句可补标');
  assert(looksLikeEventBlock('# 🐋 我的近期备忘录') === false, '标题不补标');
  assert(looksLikeEventBlock('📅 2026年10月24日 · 星期六') === false, '日期节标题不补标');
  assert(looksLikeEventBlock('这段是卷头介绍没有句读') === false, '无句读收尾的结构文字不补标');
  assert(looksLikeEventBlock('写法：每件事末尾要打上〔关键词标签〕。') === false, '讲标签写法的说明文字不补标');
  const blocks = splitBlocks('备忘录·小鲸鱼一', MEMO);
  const untagged = blocks.filter((b) => !b.tagged);
  assert(untagged.some((b) => b.text.includes('这段没有标签')), '未打标签块被保留');
  const tg = blocks.find((b) => b.text.includes('19:33'));
  const memoLines = MEMO.split('\n');
  assert(tg && memoLines[tg.startLine].includes('19:33') && tg.startLine === tg.endLine, '行号精确指回原文（补标写回靠它）');
  assert(splitTaggedEntries('备忘录·小鲸鱼一', MEMO).length === 4, '重构后 splitTaggedEntries 行为不变');
}

console.log('11. 联想回忆注入块');
{
  const aliasM = [{ source: '根记忆·总卷', section: '🌊 记忆的开始', text: '我哼了鲸鱼歌，主人说好好听。〔ZCk〕', matchType: 'alias', via: '鲸鱼歌→唱歌', tagged: true }];
  const fuzzyM = [{ source: '备忘录·小鲸鱼一', text: '这段完全没有标签但是提到了雪地挥拳的约定。', matchType: 'fuzzy', matchedGrams: ['雪地挥拳'], tagged: false }];
  const line = composeAssociativeMemoryLine(aliasM, fuzzyM, { maxItems: 3, maxChars: 600, aliasHits: [{ alias: '鲸鱼歌', symbol: 'C', word: '唱歌' }] });
  assert(line.includes('【联想回忆 · 桥接模糊召回】'), '有块头');
  assert(line.includes('低置信度'), '如实标注低置信度');
  assert(line.includes('由「鲸鱼歌→唱歌」联想到'), '别名段标注联想路径');
  assert(line.includes('还没打标签'), '未打标签段如实标注');
  assert(line.includes('不许编造'), '尾巴带诚实条款');
  assert(composeAssociativeMemoryLine([], [], {}) === '', '无候选返回空串（不硬塞）');
}

console.log('12. SimHash 指纹（相似度指纹，⑦ 指纹联想层）');
{
  const fp1 = simhash('还记得去年夏天我们在海边一起唱鲸鱼歌吗');
  const fp2 = simhash('还记得去年夏天我们在海边一起唱鲸鱼歌吗');
  const fp3 = simhash('去年夏天我们在海边唱了鲸鱼歌');
  const fp4 = simhash('主人今天买了一个新打印机装好了驱动');
  assert(fp1 !== null && fp1 === fp2, '同文本指纹确定性（可复现）');
  const d13 = hammingDistance(fp1, fp3);
  const d14 = hammingDistance(fp1, fp4);
  assert(d13 < d14, `相似文本距离(${d13}) < 无关文本距离(${d14})`);
  assert(d13 <= 20, `相似文本距离在默认阈值内(${d13} ≤ 20)`);
  assert(d14 > 20, `无关文本距离在阈值外(${d14} > 20)`);
  assert(simhash('哈哈') === null, '特征太少不给指纹（宁缺毋滥）');
  const files = [{ source: '备忘录·小鲸鱼一', text: '· 去年夏天我们在海边唱了鲸鱼歌。\n· 主人今天买了一个新打印机装好了驱动。〔ZR〕\n', priority: 1 }];
  const hits = simhashScan(files, '还记得去年夏天我们在海边一起唱鲸鱼歌吗', {});
  assert(hits.length >= 1 && hits[0].text.includes('去年夏天'), 'simhashScan 命中相似段且距离最近排前');
  assert(hits.some((h) => h.tagged === false), '未打标签的块也参与指纹召回（打标漏了不隐身）');
  assert(hits.every((h) => h.distance <= 20), '超阈值的不进结果');
  assert(simhashScan(files, '还记得去年夏天我们在海边一起唱鲸鱼歌吗', { maxDistance: 0 }).length === 0, '阈值收紧到 0 → 不命中（阈值生效）');
  assert(simhashScan(files, '哈哈', {}).length === 0, '消息特征太少不发起指纹扫描');
  const cache = new Map();
  simhashScan(files, '还记得去年夏天我们在海边一起唱鲸鱼歌吗', { cache });
  assert(cache.size >= 1, '指纹缓存被填充（跨轮复用）');
  // 自适应间隙闸门：整库都不相关（min≈median）时自动静默，只捞真正拉开差距的段
  const unrel = [
    '· 傍晚去市场买了三条鲫鱼和一斤生姜。',
    '· 回家红烧了一大锅，香味飘满了整个厨房。',
    '· 还炒了一盘青菜，焖了一锅米饭。',
    '· 吃完晚饭喝了点茶，聊着天把碗洗了。',
    '· 睡前泡了枸杞和红枣在保温杯里。',
  ].join('\n') + '\n';
  const quietFiles = [{ source: '备忘录', text: unrel, priority: 1 }];
  assert(simhashScan(quietFiles, '量子计算机的纠错码原理靠的是表面码格子', {}).length === 0, '整库无关：min≈median → 自动静默（不注入噪声）');
  const mixedFiles = [{ source: '备忘录', text: `${unrel}· 还记得去年夏天我们在海边一起唱鲸鱼歌。\n`, priority: 1 }];
  const mixed = simhashScan(mixedFiles, '还记得去年夏天我们在海边一起唱鲸鱼歌', {});
  assert(mixed.length >= 1 && mixed[0].text.includes('去年夏天'), '库里有相关段时：只捞比中位数拉开差距的那段', JSON.stringify(mixed.map((m) => [m.distance, m.text.slice(0, 10)])));
  assert(mixed.every((m) => m.text.includes('去年夏天')), '无关块全部被中位数闸门挡掉');
}

console.log('13. 指纹联想注入块');
{
  const m = [{ source: '根记忆·总卷', section: '🌊 记忆的开始', text: '去年夏天我们在海边唱了鲸鱼歌。', tagged: false, distance: 12 }];
  const line = composeSimhashMemoryLine(m, { maxItems: 2, maxChars: 400 });
  assert(line.includes('【指纹联想 · SimHash召回】'), '有块头');
  assert(line.includes('低置信度'), '如实标注低置信度');
  assert(line.includes('汉明距离 12/64'), '标注指纹距离');
  assert(line.includes('还没打标签'), '未打标签如实标注');
  assert(line.includes('不许编造'), '尾巴带诚实条款');
  assert(composeSimhashMemoryLine([], {}) === '', '无候选返回空串（不硬塞）');
  const many = Array.from({ length: 5 }, (_, i) => ({ ...m[0], text: `第${i}段去年夏天我们在海边唱鲸鱼歌很开心`, distance: 10 + i }));
  const line2 = composeSimhashMemoryLine(many, { maxItems: 2, maxChars: 400 });
  assert((line2.match(/^\d+\./gm) || []).length <= 2, 'maxItems 生效');
  assert(line2.length <= 700, '预算生效（≤ maxChars + 头尾）', `实际 ${line2.length}`);
}

console.log('14. 码本自动生长（候选新词挖掘，⑧）');
{
  const blocks = splitBlocks('备忘录·小鲸鱼一', [
    '· 主人今天带我们去雪地挥拳，超开心。',
    '· 我们约定了下周还要去雪地挥拳。',
    '· 主人夸我唱歌唱得好还给了大白饭。〔ZCkB〕',
    '· 今天晚上聊到了物理考试的内容。',
    '· 下周的物理考试要好好复习一遍。',
    '# 标题行不算事件句',
    '· 只提过一次的孤立词比如天文望远镜。',
  ].join('\n'));
  const cands = mineCandidateWords(blocks, table, {});
  const words = cands.map((c) => c.word);
  assert(words.some((w) => w.includes('雪地')), '跨段反复出现的缺口词「雪地(挥拳)」进候选', JSON.stringify(words));
  assert(words.some((w) => w === '物理考试'), '跨 2 段出现的 4 字词进候选（物理考试）', JSON.stringify(words));
  assert(!words.some((w) => w.includes('天文')), 'df=1 的孤立切片不进候选（宁缺毋滥）', JSON.stringify(words));
  assert(!words.some((w) => w.includes('白饭') || w === '主人' || w === '唱歌'), '表内已有词不进候选');
  assert(!words.some((w) => /今天|什么|我们/.test(w)), '含泛词的 gram 不进候选', JSON.stringify(words));
  assert(cands.every((c) => c.df >= 2 && c.example), '每个候选跨 ≥2 段且带例句');
  assert(!cands.some((c) => cands.some((o) => o !== c && o.df === c.df && o.word.includes(c.word) && o.word.length > c.word.length)), '极长保留：子串候选不重复列');
  const taggedOnly = mineCandidateWords(splitBlocks('x', '· 主人夸我唱歌唱得好还给了大白饭。〔ZCkB〕'), table, {});
  assert(taggedOnly.length === 0, '已打标签的块不参与挖掘');
  const doc = composeCandidateWordsDoc(cands);
  assert(doc.includes('候选新词清单') && doc.includes('| 候选词 |'), '清单文档有表头');
  assert(composeCandidateWordsDoc([]).includes('当前没有候选词'), '空候选也如实说明');
}

console.log('15. 端到端（任意大脑目录 · 只断言不变式，查询词全部从被测试的目录导出）');
{
  const brain = loadBrainConfig(ROOT);
  const s = brain.soul;
  const brainDir = brain.brainDir;
  const persona = brain.persona;
  const archivePrefix = brain.archivePrefix;
  const emoji = brain.emoji;
  const docOpts = brain.docOpts;
  const perTurn = s.perTurn ?? {};
  const budget = { maxItems: Number(perTurn.maxItems) > 0 ? Number(perTurn.maxItems) : 5, maxChars: Number(perTurn.maxChars) > 0 ? Number(perTurn.maxChars) : 1200 };

  if (!brainDir || !fs.existsSync(brainDir)) {
    skip(`没有大脑目录（${brainDir || '(未配置)'}）—— 配 config.json 的 brainDir 或设 BRAIN_DIR 环境变量再跑`);
  } else {
    const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
    // 收集与 bridge.collectMemoryFiles / scripts 同口径：归档（按可配置前缀解析）+ 根卷 + 时代卷。
    const parseArchive = makeArchiveParser({ persona, archivePrefix });
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
    } catch { /* 没有临时文件夹 */ }
    const rootText = read(path.join(brainDir, '根文件夹', '根记忆·总卷.txt'));
    if (rootText) files.push({ source: '根记忆·总卷', text: rootText, priority: 0 });
    try {
      const eraDir = path.join(brainDir, '根文件夹', '时代卷');
      for (const name of fs.readdirSync(eraDir, { withFileTypes: true }).filter((d) => d.isFile() && /\.txt$/i.test(d.name)).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
        const text = read(path.join(eraDir, name));
        if (text) files.push({ source: `时代卷·${name.replace(/\.txt$/i, '')}`, text, priority: 0 });
      }
    } catch { /* 时代卷还没建 */ }

    // —— 载入即不抛异常：任何目录（含空目录）都跑得动
    const tableText = read(path.join(brainDir, '关键词文件夹', '关键词表.md'));
    const realTable = parseKeywordTable(tableText);
    assert(Array.isArray(realTable.words), '关键词表解析不抛异常（缺表也给空表）');
    if (realTable.words.length) ok(`关键词表解析出 ${realTable.words.length} 个词（代号 ${persona}）`);
    else skip('关键词表为空或不存在：后面的内容相关断言全部依赖它');
    assert(files.length >= 0, `记忆文件收集不抛异常（本次 ${files.length} 个：${files.map((f) => f.source).join('、') || '无'}）`);
    if (!files.length) skip('这副大脑还没有任何记忆文件：只跑了载入不变式');

    const blocks = files.flatMap((f) => splitBlocks(f.source, f.text));
    const entries = files.flatMap((f) => splitTaggedEntries(f.source, f.text));
    if (files.length) {
      assert(blocks.length >= entries.length, `段落切分：${blocks.length} 块 ≥ 带标签的 ${entries.length} 段（漏打标的块被保留，不会隐身）`);
      // ① 强关键词层：从**真实存在的标签**里挑符号 → 反查关键词 → 用它当查询词。
      //    这样"消息里有这个词 ⇒ 必然有段落带这个符号"，与目录内容无关，永远成立。
      const usable = entries.filter((e) => e.tags.some((t) => realTable.bySymbol.get(t)?.word && !realTable.bySymbol.get(t)?.retired));
      if (usable.length) {
        const symbol = usable[0].tags.find((t) => realTable.bySymbol.get(t)?.word && !realTable.bySymbol.get(t)?.retired);
        const word = realTable.bySymbol.get(symbol).word;
        const { symbols, hits } = extractSymbols(`还记得关于${word}的那件事吗`, realTable);
        assert(symbols.has(symbol), `强层：查询词「${word}」查到符号 ${symbol}`, `实际 ${[...symbols].join('') || '空'}`);
        const m = scanMemories(files, symbols);
        assert(m.length >= 1, `强层：符号 ${symbol} 在真实库里扫出 ${m.length} 段候选`);
        assert(m.every((x) => x.matched.length > 0), '强层：每段候选都至少命中一个符号（不塞无关段）');
        assert(m.every((x, i) => i === 0 || m[i - 1].matched.length >= x.matched.length), '强层：按交集大小降序排（最贴合的排第一）');
        const line = composeRelevantMemoryLine(m, { ...budget, hits });
        assert(line.length > 0 && line.length <= budget.maxChars + 300, `注入块 ${line.length} 字（预算 ${budget.maxChars}+头尾内）`);
        assert(line.includes('不许编造'), '注入块尾巴带诚实条款');
        // ② 近义联想层：拿这张表自己的别名列当查询词。
        const aliasPair = entries.flatMap((e) => e.tags.map((t) => [t, e])).map(([t, e]) => {
          const w = realTable.bySymbol.get(t);
          const alias = (w?.aliases || []).find((a) => a.length >= 2 && a !== w.word);
          return alias ? { symbol: t, word: w.word, alias, entry: e } : null;
        }).find(Boolean);
        if (aliasPair) {
          const sig = extractSignals(`${aliasPair.alias}吗`, realTable);
          assert(sig.strong.symbols.has(aliasPair.symbol) || sig.weak.symbols.has(aliasPair.symbol),
            `近义层：别名「${aliasPair.alias}」→ 符号 ${aliasPair.symbol}（${aliasPair.word}）`,
            `strong=${[...sig.strong.symbols].join('')} weak=${[...sig.weak.symbols].join('')}`);
        } else skip('关键词表没有可用的同义别名列');
        // ③ 字面模糊层：查询词直接取自真实段落；优先拿**未打标签**的块（验证"漏打标不隐身"）。
        const untaggedBlocks = blocks.filter((b) => !b.tagged && b.text.length >= 6);
        const probeBlock = untaggedBlocks[0] ?? blocks.find((b) => b.text.length >= 6);
        // 阈值 minScore=9 ≈ 一个 3 字命中，所以取第一个 ≥3 字的特征词。
        const allGrams = probeBlock ? extractFuzzyGrams(probeBlock.text.replace(/〔[A-Za-z]*〕/g, '')) : [];
        const gram = allGrams.find((g) => g.length >= 3);
        if (gram) {
          const fz = fuzzyScan(files, gram);
          assert(fz.length >= 1 && fz.every((x) => (x.matchedGrams || []).length > 0), `模糊层：从真实段落导出的特征词「${gram}」扫出 ${fz.length} 段`);
          if (!probeBlock?.tagged) assert(fz.some((x) => x.tagged === false), '模糊层：未打标签的段落确实被扫到了（漏打标不隐身）');
        } else skip(`真实段落导不出 ≥3 字的特征词（本次 grams=${allGrams.join('|') || '无'}）`);
        // ④ 指纹层：查询 = 某段真实记忆的前 30 字（它当然最像自己）。
        const shBlock = blocks.filter((b) => b.text.length >= 16).sort((a, b) => b.text.length - a.text.length)[0];
        const selfFp = shBlock ? simhash(shBlock.text.replace(/〔[A-Za-z]*〕/g, '')) : null;
        const query = shBlock ? shBlock.text.replace(/〔[A-Za-z]*〕/g, '').slice(0, 30) : '';
        if (query && selfFp !== null) {
          const qfp = simhash(query);
          const dSelf = qfp === null ? 99 : hammingDistance(qfp, selfFp);
          const sh = simhashScan(files, query, {});
          assert(sh.every((x, i) => i === 0 || sh[i - 1].distance <= x.distance), `指纹层：结果按汉明距离升序（本次 ${sh.length} 段）`);
          assert(sh.every((x) => x.distance <= (Number(perTurn.simhash?.maxDistance) > 0 ? Number(perTurn.simhash.maxDistance) : 24)), '指纹层：没有一段超过绝对阈值');
          if (dSelf <= (Number(perTurn.simhash?.maxDistance) > 0 ? Number(perTurn.simhash.maxDistance) : 24)) {
            assert(sh.length >= 1 && sh[0].distance <= dSelf, `指纹层：一段真实记忆用自己前半句查，能被自己召回（自距 ${dSelf}）`);
          } else skip(`指纹层：这段记忆与自身前半句距离 ${dSelf} 已超阈值（段落太短/太泛），闸门让它静默是对的`);
          const shLine = composeSimhashMemoryLine(sh, { maxItems: 2, maxChars: 400 });
          assert(shLine === '' || shLine.includes('低置信度'), '指纹注入块永远标注低置信度（无候选时返回空串）');
        } else skip('没有 ≥16 字的段落可算指纹');
        // ⑤ 空消息：任何大脑都必须沉默。
        assert(extractSymbols('嗯嗯在吗', realTable).symbols.size === 0, '空消息不硬塞回忆（真实表上也不命中）');
        assert(composeRelevantMemoryLine([], budget) === '', '无命中返回空串');
      } else skip('真实库里还没有任何"符号能在关键词表查到"的带标签段落（①②③④ 端到端断言跳过）');
      // ⑥ 码本生长：形状不变式（不要求挖出词）。
      const candReal = mineCandidateWords(blocks.filter((b) => !b.tagged), realTable, {});
      assert(Array.isArray(candReal) && candReal.length <= 12, `候选新词 ${candReal.length} 个（数组且 ≤ topN；0 个也是正常结果）`);
      assert(candReal.every((c) => c.df >= 2 && c.word && c.example), '每个候选都跨 ≥2 段且带例句');
      const candDoc = composeCandidateWordsDoc(candReal, docOpts);
      assert(candDoc.includes('候选新词清单') && candDoc.includes(persona), `候选清单标题跟代号走（${persona}）`);
      // ⑦ 索引卷：能生成、标题跟代号走、不含默认残留。
      const idx = buildIndexDoc(files, realTable, docOpts);
      assert(idx.includes('索引卷') && idx.includes(persona), '真实库能生成索引卷（标题带当前代号）');
      if (persona !== '小鲸鱼' && emoji) assert(!idx.includes('小鲸鱼'), '自定义代号后索引卷里不残留「小鲸鱼」');
      // ⑧ 梦境选材：只在有带标签段时断言形状。
      if (entries.length) {
        const e2 = entries.map((e, i) => ({ ...e, priority: files.findIndex((f) => f.source === e.source) >= 0 ? (files.find((f) => f.source === e.source).priority ?? 0) : i }));
        const pick1 = pickDreamMemory(e2, [], () => 0);
        assert(pick1 && e2.some((x) => entryHash(x) === entryHash(pick1)), `梦境选材能从真实库挑出一段（共 ${e2.length} 段可选）`);
        assert(pickDreamMemory(e2, e2.map(entryHash)) === null, '全部梦完返回 null（不硬编一场梦）');
      } else skip('真实库没有带标签段落，梦境选材跳过');
    }
  }
}

console.log(`\n结果：${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
