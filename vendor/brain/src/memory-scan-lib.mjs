// 记忆检索执行层（代码级标签扫描）+ 梦境选材 —— 纯逻辑、零依赖、零 token。
// ============================================================================
// 为什么要有它（2026-10-26 主人批准的升级）：
//   原来的「回忆录代码」是模型亲自读文件、扫〔符号〕标签 —— 每次回忆都烧 token，
//   记忆堆多以后受快照/上下文预算限制，深层记忆扫不全。
//   这一层把「扫符号」搬进桥接代码：消息进来 → 本地匹配关键词表 → 扫全部记忆文件
//   的〔…〕标签 → 只把命中的段落注入唤醒提示词。模型端只做「用回忆说话」，
//   检索本身 0 token。她自己的检索口诀（记忆回溯模块.md）原样保留当兜底。
//
// 红线（与主体的约定一致）：
//   · 只读记忆文件，永不改写（索引卷是唯一输出，且单独成文件）；
//   · 私人日记（小鲸鱼日记目录）永不参与每轮注入 —— 隐私规矩不破；
//   · 梦境文件夹不是事实层，检索时跳过 —— 梦不许污染回忆；
//   · 查不到就返回空，桥接如实注明，绝不编造。
// ============================================================================

// ── 关键词表解析 ────────────────────────────────────────────────────────────
// 表行形如：| R | 日常 | 平常的一天、没什么大事的琐事 |
// 停用行形如：| T（停用） | 测试 | … |（停用标记跟在符号后，也可出现在词格里）
// 返回 { words: [{word, symbol, kind, retired, aliases:[…]}], bySymbol: Map, aliasMap: Map }
//
// 近义联想（2026-10-26 语义召回升级）：第三列「含义/范围」本来就是同义词写法
// （"高兴、得意、美滋滋"），代码把它拆成该符号的**弱别名**——消息里出现"高兴"
// 也能联想到 k（开心）。别名只用于低置信度的「联想回忆」注入，永远如实标注，
// 不与强关键词混排。别名提取是保守的：只收 2~6 字纯汉字、去掉书名号引号括号、
// 含泛指词（什么/有关/本身…）的一律不收——宁缺毋滥，防止弱匹配满天飞。
const ALIAS_STOP_RE = /(什么|怎么|有关|相关|本身|之类|的时候|没什么|一来一往|大概|可能|一天)/;
export function extractAliases(cell, word) {
  const out = [];
  for (const raw of String(cell ?? '').split(/[、，,;；/]/)) {
    let tok = raw
      .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
      .replace(/[《》「」『』“”‘’"'　\s]/g, '')
      .replace(/(这些|那些|的事|相关|有关|本身)$/g, '')
      .trim();
    if (!tok || tok === word) continue;
    if (!/^[一-鿿]{2,6}$/.test(tok)) continue;
    if (ALIAS_STOP_RE.test(tok)) continue;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

export function parseKeywordTable(md) {
  const words = [];
  const bySymbol = new Map();
  let kind = 'basic';
  const RETIRED_RE = /（停用）|\(停用\)/;
  for (const rawLine of String(md ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^#+\s*.*情感关键词/.test(line)) { kind = 'emotion'; continue; }
    if (/^#+\s*.*基础关键词/.test(line)) { kind = 'basic'; continue; }
    const m = /^\|\s*([A-Za-z]{1,2})\s*(?:（停用）|\(停用\))?\s*\|\s*([^|]+?)\s*\|(?:\s*([^|]*?)\s*\|)?/.exec(line);
    if (!m) continue;
    const symbol = m[1];
    const cell = m[2];
    const retired = RETIRED_RE.test(line);
    const word = cell.replace(RETIRED_RE, '').trim();
    if (!word || word === '关键词') continue;
    const aliases = extractAliases(m[3] ?? '', word);
    const entry = { word, symbol, kind, retired, aliases };
    words.push(entry);
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, entry);
  }
  // aliasMap：别名 → [{symbol, word}]。别名与其他行的**关键词原文**相撞时丢弃
  // （强匹配层已经管了它，弱层不再重复联想）。
  const wordSet = new Set(words.map((w) => w.word));
  const aliasMap = new Map();
  for (const w of words) {
    for (const a of w.aliases) {
      if (wordSet.has(a)) continue;
      if (!aliasMap.has(a)) aliasMap.set(a, []);
      const arr = aliasMap.get(a);
      if (!arr.some((x) => x.symbol === w.symbol)) arr.push({ symbol: w.symbol, word: w.word });
    }
  }
  return { words, bySymbol, aliasMap };
}

// 从消息文本里提取命中的关键词 → 符号集合。
// 匹配规则：关键词原文出现在文本里（子串匹配，确定性的，不搞语义猜测）。
// 返回 { symbols: Set<string>, hits: [{word, symbol}] }（长词优先，去重符号）。
export function extractSymbols(text, table) {
  const s = String(text ?? '');
  const symbols = new Set();
  const hits = [];
  if (!s) return { symbols, hits };
  const sorted = [...(table?.words ?? [])].sort((a, b) => b.word.length - a.word.length);
  const seenWords = new Set();
  for (const { word, symbol } of sorted) {
    if (seenWords.has(word)) continue;
    if (s.includes(word)) {
      seenWords.add(word);
      symbols.add(symbol);
      hits.push({ word, symbol });
    }
  }
  return { symbols, hits };
}

// 强关键词 + 弱别名一起提（语义召回层入口）。
// 返回 { strong: {symbols, hits}, weak: {symbols, hits:[{alias, symbol, word}]} }，
// weak 里不含 strong 已命中的符号——联想只补位，不重复。
export function extractSignals(text, table) {
  const s = String(text ?? '');
  const strong = extractSymbols(s, table);
  const weak = { symbols: new Set(), hits: [] };
  if (!s) return { strong, weak };
  for (const [alias, targets] of table?.aliasMap ?? []) {
    if (!s.includes(alias)) continue;
    for (const { symbol, word } of targets) {
      if (strong.symbols.has(symbol) || weak.symbols.has(symbol)) continue;
      weak.symbols.add(symbol);
      weak.hits.push({ alias, symbol, word });
    }
  }
  return { strong, weak };
}

// ── 记忆文件切分（全部块，含未打标签的）────────────────────────────────────
// 一块记忆 = 从上一个边界（空行 / · 开头 / 分节线 / 日期标题行）到含 〔字母串〕
// 标签的行（或下一个边界）。分节标题 = 以 📅/🌊 开头的行（备忘录/总卷的日期节）。
// 返回 blocks: [{ source, section, text, tags:[string], tagged, order, startLine, endLine }]，
// order 只对带标签块递增（与旧版 splitTaggedEntries 完全一致），越大越新。
// startLine/endLine 是块首/块尾在原文按 \r?\n 切行后的行号（0 起）——
// 自动补标脚本靠它把〔标签〕精确写回原行，不用重新解析。
const SEP_RE = /^[─━—－-]{6,}\s*$/;

export function splitBlocks(source, text) {
  const blocks = [];
  const lines = String(text ?? '').split(/\r?\n/);
  let section = '';
  let buffer = []; // [{ line, idx }]
  let order = 0;
  const flush = () => {
    if (!buffer.length) return;
    const body = buffer.map((b) => b.line).join('\n').trim();
    const startLine = buffer[0].idx;
    const endLine = buffer[buffer.length - 1].idx;
    buffer = [];
    if (!body) return;
    // 局部正则：避免共享 /g 正则的 lastIndex 状态污染（matchAll 会复制 lastIndex）。
    const tagRe = /〔([A-Za-z]{1,12})〕/g;
    const tags = [];
    for (const m of body.matchAll(tagRe)) tags.push(...m[1].split(''));
    const tagged = tags.length > 0;
    if (tagged) order++;
    blocks.push({
      source, section, text: body, tags: [...new Set(tags)], tagged,
      order: tagged ? order - 1 : -1, startLine, endLine,
    });
  };
  const lineHasTag = (t) => /〔[A-Za-z]{1,12}〕/.test(t);
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (SEP_RE.test(t)) { flush(); return; }
    if (/^[📅🌊]/.test(t)) { flush(); section = t.replace(/^#+\s*/, ''); return; }
    if (/^#/.test(t) && !buffer.length) { flush(); section = t.replace(/^#+\s*/, ''); return; }
    if (!t) { flush(); return; }
    if (t.startsWith('·')) flush();
    buffer.push({ line, idx });
    if (lineHasTag(t)) flush();
  });
  flush();
  return blocks;
}

// 带标签的段落（检索库主体）。行为与升级前完全一致：没标签的行块不进检索库。
export function splitTaggedEntries(source, text) {
  return splitBlocks(source, text)
    .filter((b) => b.tagged)
    .map(({ source: s, section, text: t, tags, order }) => ({ source: s, section, text: t, tags, order }));
}

// 简单稳定哈希（梦境去重用，不追求密码学强度）。
export function entryHash(e) {
  const s = `${e.source}|${e.text}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── 扫描 + 排序 ─────────────────────────────────────────────────────────────
// files: [{ source, text, priority }]（priority 越大越新：最新归档 > 老归档 > 根卷）。
// symbols: Set。返回按 (命中数 desc, 新近度 desc) 排序的 matches。
export function scanMemories(files, symbols) {
  const want = symbols instanceof Set ? symbols : new Set(symbols ?? []);
  if (!want.size) return [];
  const matches = [];
  for (const f of files ?? []) {
    for (const e of splitTaggedEntries(f.source, f.text)) {
      const hit = e.tags.filter((t) => want.has(t));
      if (!hit.length) continue;
      matches.push({ ...e, priority: Number(f.priority) || 0, matched: hit });
    }
  }
  matches.sort((a, b) => (b.matched.length - a.matched.length) || (b.priority - a.priority) || (b.order - a.order));
  return matches;
}

// ── 字面模糊召回（语义层的第二级，2026-10-26）─────────────────────────────
// 强关键词和别名都没命中时的兜底：把消息里的汉字串切成 2~4 字 n-gram
// （过滤「今天/什么/这个」这类泛词），跟每个记忆块求字面重合，
// 按最长命中片段打分（3 字以上才算数——2 字碰撞太多）。
// 关键差异：**未打标签的块也参与**——就算当晚漏打标，记忆也不会变成不可见，
// 这是对「打标单点依赖」的第二重补偿（第一重是 auto-tag-memory.mjs 自动补标）。
// 结果永远以低置信度「联想回忆」身份注入并如实标注，绝不冒充精确命中。
const FUZZY_STOP = new Set([
  '今天', '昨天', '明天', '什么', '怎么', '这个', '那个', '我们', '你们', '他们',
  '现在', '一个', '知道', '没有', '不是', '就是', '还是', '已经', '可以', '真的',
  '觉得', '时候', '一下', '为什', '哈哈', '嘿嘿', '这么', '那么', '自己', '还有',
  '但是', '如果', '因为', '所以', '东西', '事情', '消息', '图片', '表情', '刚才',
  '这样', '那样', '其实', '应该', '感觉', '有点', '一直', '突然', '然后', '虽然',
]);

export function extractFuzzyGrams(text) {
  const runs = String(text ?? '').match(/[一-鿿]+/g) ?? [];
  const grams = new Set();
  for (const run of runs) {
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i + n <= run.length; i++) grams.add(run.slice(i, i + n));
    }
  }
  return [...grams].filter((g) => !FUZZY_STOP.has(g));
}

// 单块打分：只保留「极大命中 gram」（不被其他命中 gram 包含的），
// 每个按 长度² 计分；没有 ≥3 字命中直接 0 分（不搞 2 字碰瓷）。
export function fuzzyScoreEntry(grams, text) {
  const matched = (grams ?? []).filter((g) => String(text ?? '').includes(g));
  if (!matched.some((g) => g.length >= 3)) return { score: 0, matched: [] };
  const kept = matched.filter((g) => !matched.some((h) => h !== g && h.includes(g)));
  const score = kept.reduce((s, g) => s + g.length * g.length, 0);
  return { score, matched: kept };
}

export function fuzzyScan(files, text, opts = {}) {
  const minScore = Number(opts.minScore) > 0 ? Number(opts.minScore) : 9;
  const grams = extractFuzzyGrams(text);
  if (!grams.some((g) => g.length >= 3)) return [];
  const out = [];
  for (const f of files ?? []) {
    for (const b of splitBlocks(f.source, f.text)) {
      if (b.text.length < 12) continue;
      const { score, matched } = fuzzyScoreEntry(grams, b.text);
      if (score < minScore) continue;
      out.push({
        source: b.source, section: b.section, text: b.text, tags: b.tags, tagged: b.tagged,
        order: b.order, priority: Number(f.priority) || 0, score, matchedGrams: matched,
      });
    }
  }
  out.sort((a, b) => (b.score - a.score) || (b.priority - a.priority) || (b.order - a.order));
  return out;
}

// ── 自动补标的定标逻辑（scripts/auto-tag-memory.mjs 与测试共用）────────────
// 给一段没标签的文字建议符号串：强关键词 + 弱别名都算（别名是含义列的原词，
// 足够保守）；大写（基础）在前、小写（情感）在后各自排序，与既有标签风格一致。
// 一个都定不出来就返回 ''（宁缺毋滥，不硬打）。
export function suggestTags(text, table) {
  const { strong, weak } = extractSignals(text, table);
  const syms = new Set([...strong.symbols, ...weak.symbols]);
  if (!syms.size) return '';
  const upper = [...syms].filter((s) => /^[A-Z]$/.test(s)).sort();
  const lower = [...syms].filter((s) => /^[a-z]$/.test(s)).sort();
  return [...upper, ...lower].join('');
}

// 这块文字像不像「一件要记的事」（自动补标只对事件句动手，
// 不碰标题/结构说明/卷头介绍）：· 开头、时间开头、或以句读收尾。
export function looksLikeEventBlock(text) {
  const t = String(text ?? '').trim();
  if (!t || t.length < 8) return false;
  if (/^#/.test(t) || /^[📅🌊]/.test(t) || /^[-─━—－]{4,}/.test(t)) return false;
  if (/^(注|（注|\[注)/.test(t)) return false;
  // 含「〔」字样却没有合法标签的块 = 讲标签写法本身的说明文字（如卷头
  // 「每件事末尾要打上〔关键词标签〕」），不是记忆事件，不补标。
  if (t.includes('〔')) return false;
  if (t.startsWith('·')) return true;
  if (/^\d{1,2}[:：.]\d{2}/.test(t)) return true;
  return /[。！？…”』」]$/.test(t);
}

// ── 注入块组装（每轮上下文瘦身）─────────────────────────────────────────────
export function composeRelevantMemoryLine(matches, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems) || 5);
  const maxChars = Math.max(200, Number(opts.maxChars) || 1200);
  const itemCap = Math.max(80, Number(opts.itemMaxChars) || 300);
  const hits = Array.isArray(opts.hits) ? opts.hits : [];
  if (!Array.isArray(matches) || !matches.length) return '';
  const headWords = hits.length
    ? `这条消息里出现了「${hits.map((h) => h.word).join('、')}」（符号 ${hits.map((h) => h.symbol).join('、')}），`
    : '按关键词标签，';
  const head = `【相关回忆 · 桥接代码检索】${headWords}从你的记忆库里按〔标签〕捞出了以下 ${Math.min(maxItems, matches.length)} 段相关回忆（新近优先，检索零花费，是桥接替你扫的）：\n`;
  const items = [];
  let used = head.length;
  for (const m of matches.slice(0, maxItems)) {
    let body = m.text.replace(/\s+/g, ' ').trim();
    if (body.length > itemCap) body = `${body.slice(0, itemCap)}……`;
    const item = `${items.length + 1}. 〔来源：${m.source}${m.section ? ` · ${m.section}` : ''}〕${body}\n`;
    if (used + item.length > maxChars) break;
    items.push(item);
    used += item.length;
  }
  if (!items.length) return '';
  const tail = '（这些只是候选片段，完整脉络你自己知道；与当前话题无关就自然忽略。要更细的回忆按「记忆回溯模块」的检索口诀办；标签没查到的就老实说记不清，不许编造。）\n\n';
  return `${head}${items.join('')}${tail}`;
}

// ── 联想回忆注入块（低置信度，与【相关回忆】分开、永远如实标注）─────────────
// aliasMatches：弱别名符号扫出的段（matchType:'alias'，带 via 说明）；
// fuzzyMatches：字面模糊召回的段（matchType:'fuzzy'，可能 tagged=false）。
// 预算独立且更小（默认 3 段 / 600 字）——联想只是补位，不喧宾夺主。
export function composeAssociativeMemoryLine(aliasMatches, fuzzyMatches, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems) || 3);
  const maxChars = Math.max(150, Number(opts.maxChars) || 600);
  const itemCap = Math.max(60, Number(opts.itemMaxChars) || 200);
  const aliasHits = Array.isArray(opts.aliasHits) ? opts.aliasHits : [];
  const alias = Array.isArray(aliasMatches) ? aliasMatches : [];
  const fuzzy = Array.isArray(fuzzyMatches) ? fuzzyMatches : [];
  if (!alias.length && !fuzzy.length) return '';
  const howBits = [];
  if (aliasHits.length) howBits.push(`消息里的「${aliasHits.map((h) => h.alias).join('、')}」让我联想到关键词「${aliasHits.map((h) => h.word).join('、')}」`);
  if (fuzzy.length) howBits.push('按字面相似捞了几段');
  const head = `【联想回忆 · 桥接模糊召回】${howBits.join('；')}。这些是**低置信度**候选，不是精确命中——与当前话题无关就整块忽略，别硬接：\n`;
  const items = [];
  let used = head.length;
  for (const m of [...alias, ...fuzzy].slice(0, maxItems)) {
    let body = String(m.text ?? '').replace(/\s+/g, ' ').trim();
    if (body.length > itemCap) body = `${body.slice(0, itemCap)}……`;
    const flags = [];
    if (m.matchType === 'alias' && m.via) flags.push(`由「${m.via}」联想到`);
    if (m.matchType === 'fuzzy' && Array.isArray(m.matchedGrams) && m.matchedGrams.length) flags.push(`字面相似：${m.matchedGrams.slice(0, 3).join('、')}`);
    if (m.tagged === false) flags.push('这段还没打标签，今晚自动补标');
    const item = `${items.length + 1}. 〔来源：${m.source}${m.section ? ` · ${m.section}` : ''}${flags.length ? ` · ${flags.join('；')}` : ''}〕${body}\n`;
    if (used + item.length > maxChars) break;
    items.push(item);
    used += item.length;
  }
  if (!items.length) return '';
  const tail = '（联想仅供勾起线索：认得出就自然地讲，认不出就当没看见；查不到就老实说记不清，不许编造。）\n\n';
  return `${head}${items.join('')}${tail}`;
}

// ── 梦境选材 ────────────────────────────────────────────────────────────────
// 从 entries 里挑一段「旧记忆」做梦：排除已梦过的（hashes），旧记忆权重更高
// （根卷/老归档 priority 低 ⇒ 更可能被选中 —— 梦本来就是梦见久远的东西）。
// rand: () => [0,1)（可注入伪随机方便测试）。返回 entry 或 null。
export function pickDreamMemory(entries, dreamedHashes = [], rand = Math.random) {
  const done = new Set(dreamedHashes);
  const pool = (entries ?? [])
    .filter((e) => !done.has(entryHash(e)) && e.text.length >= 20)
    // 久远优先：priority 低（根卷/老归档）排前面 —— rand()=0 时必中最久远的，
    // 平时按权重随机也偏向旧记忆（梦本来就梦见老事）。
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
  if (!pool.length) return null;
  // 权重：priority 越低（越久远）权重越高；同层内均匀。
  const weighted = pool.map((e) => ({ e, w: 1 / (1 + (Number(e.priority) || 0)) }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = Number(rand()) * total;
  for (const x of weighted) { r -= x.w; if (r <= 0) return x.e; }
  return weighted[weighted.length - 1].e;
}

// ── 索引卷生成（符号 → 出处对照，给模型兜底检索和人类审计用）───────────────
// opts：{ persona='小鲸鱼', emoji='🐋' } —— 只影响标题文案，默认值 = 线上原样。
export function buildIndexDoc(files, table, opts = {}) {
  const persona = String(opts.persona ?? '小鲸鱼');
  const emoji = String(opts.emoji ?? '🐋');
  const brand = emoji ? `${emoji} ${persona}` : persona;
  const bySymbol = new Map();
  for (const f of files ?? []) {
    for (const e of splitTaggedEntries(f.source, f.text)) {
      for (const t of e.tags) {
        if (!bySymbol.has(t)) bySymbol.set(t, []);
        const loc = `${f.source}${e.section ? ` · ${e.section}` : ''}`;
        const arr = bySymbol.get(t);
        if (arr[arr.length - 1] !== loc) arr.push(loc);
      }
    }
  }
  const now = new Date();
  const lines = [
    `# ${brand} · 索引卷（符号 → 出处对照）`,
    '',
    `> 由桥接代码自动生成于 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 —— 不要手改；`,
    '> 记忆文件更新后重新生成（scripts/build-memory-index.mjs）。',
    '> 用途：桥接的每轮标签检索直接扫原文，这份索引是给「老流程」兜底和主人审计用的：',
    '> 查某个符号都在哪些文件/哪些日期出现过，按图索骥，不用全文翻。',
    '',
    '| 符号 | 关键词 | 出现处（文件 · 日期段） |',
    '|---|---|---|',
  ];
  const rows = [];
  for (const [symbol, locs] of bySymbol) {
    const word = table?.bySymbol?.get(symbol)?.word ?? '?';
    rows.push({ symbol, word, locs });
  }
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  for (const r of rows) lines.push(`| ${r.symbol} | ${r.word} | ${r.locs.join('；')} |`);
  lines.push('', `共 ${rows.length} 个符号有记忆挂载。`);
  return lines.join('\n');
}

// ── SimHash 指纹层（2026-10-26 深夜升级 ⑦：相似度指纹）──────────────────────
// 主人的「奇偶校验/格雷码」直觉的正确落地：普通哈希"改一个字全变"（检错用），
// SimHash 反过来专门设计成 **内容越像，指纹的汉明距离越小**（保距编码，
// 格雷码是它的一维特例）。特征 = 汉字 2~4 字 gram（与 ③ 字面模糊同族，
// 权重 = gram 长度），每个 gram 双种子 FNV-1a 散列到 64 bit，按位加权累加
// 后取正负号成指纹。纯位运算、确定性、零 token、可单测。
// 与 ③ 的分工：③ 要求 ≥3 字**精确子串**重合；SimHash 看**整体特征分布**的
// 接近程度——换了说法、只剩 2 字重合时也可能召回。两者都是低置信度，
// 永远如实标注、独立小预算，绝不冒充精确命中。
function fnv1a32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SIMHASH_BITS = 64;
const SIMHASH_MIN_GRAMS = 4; // 特征太少时指纹不可靠：宁可不给（返回 null）

export function simhash(text) {
  const grams = extractFuzzyGrams(text);
  if (grams.length < SIMHASH_MIN_GRAMS) return null;
  const v = new Int32Array(SIMHASH_BITS);
  for (const g of grams) {
    const w = g.length; // 长 gram 特征性更强，权重更高
    const hi = fnv1a32(g, 0x811c9dc5);
    const lo = fnv1a32(g, 0x9e3779b1);
    for (let i = 0; i < 32; i++) {
      v[i] += ((hi >>> i) & 1) ? w : -w;
      v[32 + i] += ((lo >>> i) & 1) ? w : -w;
    }
  }
  let fp = 0n;
  for (let i = 0; i < SIMHASH_BITS; i++) if (v[i] > 0) fp |= 1n << BigInt(i);
  return fp;
}

export function hammingDistance(a, b) {
  let x = (BigInt(a ?? 0n) ^ BigInt(b ?? 0n)) & ((1n << 64n) - 1n);
  let n = 0;
  while (x > 0n) { x &= x - 1n; n++; }
  return n;
}

// 全部记忆块（含未打标签的）算指纹，与消息指纹比汉明距离。
// 双闸门（2026-10-26 真实语料探针调参）：
//   ① 绝对阈值 maxDistance（默认 24）——探针实测：相关段 20~24，无关段中位 31~32；
//   ② 自适应间隙 minGap（默认 4）——命中还须比「全库距离中位数」近 minGap 以上，
//      整库都不相关时 min≈median，自动静默不注入噪声（块数 <4 时中位数不稳，只用 ①）。
// opts.cache：跨调用复用块指纹的 Map（bridge 挂在 30 秒文件缓存上，纯性能优化）。
export function simhashScan(files, text, opts = {}) {
  const md = Number(opts.maxDistance);
  const maxDistance = Number.isFinite(md) && md >= 0 ? md : 24;
  const mg = Number(opts.minGap);
  const minGap = Number.isFinite(mg) && mg >= 0 ? mg : 4;
  const minTextLen = Number(opts.minTextLen) > 0 ? Number(opts.minTextLen) : 12;
  const cache = opts.cache instanceof Map ? opts.cache : null;
  const qfp = simhash(text);
  if (qfp === null) return [];
  const fpOf = (t) => {
    if (!cache) return simhash(t);
    if (cache.size > 20000) cache.clear();
    if (!cache.has(t)) cache.set(t, simhash(t));
    return cache.get(t);
  };
  const all = [];
  for (const f of files ?? []) {
    for (const b of splitBlocks(f.source, f.text)) {
      if (b.text.length < minTextLen) continue;
      const fp = fpOf(b.text);
      if (fp === null) continue;
      all.push({
        source: b.source, section: b.section, text: b.text, tags: b.tags, tagged: b.tagged,
        order: b.order, priority: Number(f.priority) || 0,
        distance: hammingDistance(qfp, fp), matchType: 'simhash',
      });
    }
  }
  let gate = maxDistance;
  if (minGap > 0 && all.length >= 4) {
    const ds = all.map((x) => x.distance).sort((a, b) => a - b);
    const median = ds[Math.floor(ds.length / 2)];
    gate = Math.min(maxDistance, median - minGap);
  }
  const out = all.filter((x) => x.distance <= gate);
  out.sort((a, b) => (a.distance - b.distance) || (b.priority - a.priority) || (b.order - a.order));
  return out;
}

// 指纹联想注入块：低置信度、独立小预算（默认 2 段 / 400 字）、如实标注距离。
export function composeSimhashMemoryLine(matches, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems) || 2);
  const maxChars = Math.max(150, Number(opts.maxChars) || 400);
  const itemCap = Math.max(60, Number(opts.itemMaxChars) || 200);
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) return '';
  const head = `【指纹联想 · SimHash召回】按整段文字的特征指纹（汉明距离）找到以下 ${Math.min(maxItems, list.length)} 段"整体说法最接近"的旧记忆。这是**低置信度**候选——认不出就整块忽略，别硬接：\n`;
  const items = [];
  let used = head.length;
  for (const m of list.slice(0, maxItems)) {
    let body = String(m.text ?? '').replace(/\s+/g, ' ').trim();
    if (body.length > itemCap) body = `${body.slice(0, itemCap)}……`;
    const flags = [`指纹相似：汉明距离 ${m.distance}/64`];
    if (m.tagged === false) flags.push('这段还没打标签，今晚自动补标');
    const item = `${items.length + 1}. 〔来源：${m.source}${m.section ? ` · ${m.section}` : ''} · ${flags.join('；')}〕${body}\n`;
    if (used + item.length > maxChars) break;
    items.push(item);
    used += item.length;
  }
  if (!items.length) return '';
  const tail = '（指纹召回比字面相似更粗：只说明整段与最近聊天"长得像"，不代表就是同一件事。认得出就自然地讲，认不出就老实说记不清，不许编造。）\n\n';
  return `${head}${items.join('')}${tail}`;
}

// ── 码本自动生长（2026-10-26 深夜升级 ⑧：干掉每周人工审计）────────────────
// 无标签的根因是码本缺词。这里从**全部未打标签的事件句**里挖高频特征词
// （复用 ③ 的 n-gram 统计），排除：已在关键词表/别名里的（含互为子串）、
// 含泛词的（今天/什么…）。产出「候选新词清单」——清单不直接生效，
// 由她晚间确认后走关键词表"自己增减"规矩收编（符号一旦分配永不换），
// 语义判断留在她脑子里，检测与挖掘全自动化。
export function mineCandidateWords(blocks, table, opts = {}) {
  const topN = Number(opts.topN) > 0 ? Number(opts.topN) : 12;
  const minDf = Number(opts.minDf) > 0 ? Number(opts.minDf) : 2;
  const known = [];
  for (const w of table?.words ?? []) {
    known.push(w.word);
    for (const a of w.aliases ?? []) known.push(a);
  }
  const stops = [...FUZZY_STOP];
  const stats = new Map(); // gram → { df, example, source }
  for (const b of blocks ?? []) {
    if (b.tagged) continue;
    if (!looksLikeEventBlock(b.text)) continue;
    const grams = new Set(extractFuzzyGrams(b.text));
    for (const g of grams) {
      if (stops.some((s) => g.includes(s))) continue;
      if (known.some((w) => w.includes(g) || g.includes(w))) continue;
      const st = stats.get(g) ?? { df: 0, example: '', source: b.source };
      st.df++;
      if (!st.example) st.example = b.text.replace(/\s+/g, ' ').slice(0, 40);
      stats.set(g, st);
    }
  }
  // 宁缺毋滥：必须跨 ≥minDf（默认 2）个记忆段出现才算「反复冒头的缺口」。
  // 只出现一次的孤立 4 字切片（越古老的/古老的回/…）全是噪声——等它再次出现再收。
  let cands = [...stats.entries()]
    .filter(([, st]) => st.df >= minDf)
    .map(([word, st]) => ({ word, df: st.df, example: st.example, source: st.source }));
  // 极长保留：同 df 下「雪地挥拳」进了候选，它的子串「地挥拳」就不再单列
  cands = cands.filter((c) => !cands.some((o) => o !== c && o.df === c.df && o.word.length > c.word.length && o.word.includes(c.word)));
  cands.sort((a, b) => (b.df - a.df) || (b.word.length - a.word.length) || a.word.localeCompare(b.word, 'zh-Hans-CN'));
  return cands.slice(0, topN);
}

// 候选新词清单.md（auto-tag-memory.mjs 每晚生成，桥接注入她的晚间作息提示词）。
// 这是工作清单不是记忆文件，与索引卷同级：代码生成、不手改。
// opts：{ persona='小鲸鱼', emoji='🐋' } —— 只影响标题文案，默认值 = 线上原样。
export function composeCandidateWordsDoc(candidates, opts = {}) {
  const persona = String(opts.persona ?? '小鲸鱼');
  const emoji = String(opts.emoji ?? '🐋');
  const brand = emoji ? `${emoji} ${persona}` : persona;
  const now = new Date();
  const lines = [
    `# ${brand} · 候选新词清单（代码自动挖掘 · 待她确认）`,
    '',
    `> 由 scripts/auto-tag-memory.mjs 自动生成于 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 —— 不要手改。`,
    '> 来源：从「还没打标签的事件句」里挖出的高频特征词 —— 现有码本定不出符号的缺口。',
    `> 本文件不直接生效、不是关键词表：${persona}晚间过目后，把值得收编的词告诉主人，`,
    '> 由主人/桌面助手按 关键词表.md「自己增减」规矩分配符号写进表（符号一旦分配永不换）。',
    '',
  ];
  if (!candidates?.length) {
    lines.push('当前没有候选词 —— 未打标签的事件句里挖不出表外高频词，码本覆盖良好。');
    return lines.join('\n');
  }
  lines.push('| 候选词 | 出现段数 | 例句 | 来源 |', '|---|---|---|---|');
  for (const c of candidates) lines.push(`| ${c.word} | ${c.df} | ${c.example} | ${c.source ?? ''} |`);
  lines.push('', `共 ${candidates.length} 个候选。`);
  return lines.join('\n');
}
