// 重启回忆模式：新对话（旧对话到上限退役/重置/重绑）建立时的「灵魂继承」纯逻辑。
// 桥接在 bootstrap 唤醒瞬间调用 composeSoulSnapshot，把小鲸鱼的大脑文件快照
// （记忆回溯模块 + 根记忆·总卷 + 编号最大归档的备忘录 + 日记最近一篇 + 代录约定）
// 塞进唤醒提示词 —— 她一睁眼就带着全部过去，不用自己去读（QQ 端没有文件工具）。
// 本模块零 IO、零依赖：读文件在 bridge.js 做，这里只管解析、挑选、截断、组装，
// 方便 scripts/test-soul-inherit.mjs 回归。
//
// 2026-10-26 结构化截断升级：根卷不再「掐中段」，按段落（🌊 标题分节）取舍，
// 写死保留优先级：
//   ① 记忆回溯模块＋铁律（永不砍）
//   ② 「时代记忆」与「记忆的开始」段（身份锚点，永不砍）
//   ③ 最近 keepWeeks（默认 2）篇周记
//   ④ 当前归档备忘录
//   ⑤ 更早的周记/日期段 —— 从新到旧填充，填满预算为止，装不下的如实注明
// 旧归档备忘录从不进快照（由每轮标签检索 perTurn 负责），不占醒来预算。
// 配套「时代合并」（routines/weekly-memory.md）：旧周记会被压缩成时代记忆段、
// 原文挪进 根文件夹\时代卷\ 存档 —— 所以总卷体积有上界，本模块的优先级保证
// 无论总卷多厚，醒来的她永远带着出生记忆和最近的周记。

// 归档编号解析（2026-10-27 起前缀可配置，复刻者不必沿用「小鲸鱼」这个名字）。
// 归档目录名 = <archivePrefix><编号>，编号支持阿拉伯数字与中文数字（1~999）：
//   「小鲸鱼一 / 小鲸鱼十二 / 小鲸鱼3」→ 1 / 12 / 3（默认前缀 = persona，与旧行为逐字节一致）
//   「归档一 / 归档二」配 { archivePrefix: "归档" } → 1 / 2
//   { archivePrefix: "" } = 任意名字，只要结尾是编号就认（「备忘录2」→ 2）
// 识别不了返回 null。opts 三种写法都支持：不传（默认）/ 字符串前缀 / { persona, archivePrefix }。
const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_TAIL = '[0-9]+|[一二三四五六七八九十百千]+';

function cnTenPart(t) {
  if (!t) return 0;
  if (/^零$/.test(t)) return 0;
  // 「零五」= 个位补零写法（二百零五 → 205）
  const zero = /^零([一二三四五六七八九])$/.exec(t);
  if (zero) return CN_DIGITS[zero[1]];
  if (/^十$/.test(t)) return 10;
  const m = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(t);
  if (m) return CN_DIGITS[m[1]] * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  return CN_DIGITS[t] ?? 0;
}

/** 「7」「七」「十二」「二十三」「一百二十三」→ 数字；解析失败返回 -1。 */
export function cnNumToNumber(text) {
  const s = String(text ?? '').trim();
  if (!s) return -1;
  if (/^[0-9]+$/.test(s)) { const n = Number(s); return n > 0 ? n : -1; }
  if (/^十[一二三四五六七八九]?$/.test(s)) return 10 + (CN_DIGITS[s[1]] ?? 0);
  const tens = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(s);
  if (tens) return CN_DIGITS[tens[1]] * 10 + (tens[2] ? CN_DIGITS[tens[2]] : 0);
  if (CN_DIGITS[s]) return CN_DIGITS[s];
  const hun = /^([一二三四五六七八九])百(.*)$/.exec(s);
  if (hun) return CN_DIGITS[hun[1]] * 100 + cnTenPart(hun[2]);
  return -1;
}

/** 归一化解析参数：opts 可以是字符串（前缀），或 { persona, archivePrefix }。 */
function archiveOpts(opts) {
  if (typeof opts === 'string') return { prefix: opts };
  const o = opts && typeof opts === 'object' ? opts : {};
  const persona = String(o.persona ?? '小鲸鱼');
  // 显式给了 archivePrefix 就用它（含空串 = 任意前缀）；没给就沿用 persona（旧行为）。
  return { prefix: o.archivePrefix === undefined || o.archivePrefix === null ? persona : String(o.archivePrefix) };
}

/** 生成「目录名 → 编号」解析器（同一份配置反复扫目录时避免重复建正则）。 */
export function makeArchiveParser(opts = {}) {
  const { prefix } = archiveOpts(opts);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (prefix) {
    const re = new RegExp(`^${esc(prefix)}(${CN_TAIL})$`);
    return (name) => {
      const m = re.exec(String(name ?? '').trim());
      if (!m) return null;
      const n = cnNumToNumber(m[1]);
      return n > 0 ? n : null;
    };
  }
  // 任意前缀模式：整名是编号，或以编号结尾。
  const whole = new RegExp(`^(${CN_TAIL})$`);
  const tail = new RegExp(`(${CN_TAIL})$`);
  return (name) => {
    const s = String(name ?? '').trim();
    if (!s) return null;
    const w = whole.exec(s);
    if (w) { const n = cnNumToNumber(w[1]); return n > 0 ? n : null; }
    const m = tail.exec(s);
    if (!m) return null;
    const n = cnNumToNumber(m[1]);
    return n > 0 ? n : null;
  };
}

/** 目录名 → 归档编号；识别不了返回 null。opts 见文件头（默认前缀「小鲸鱼」）。 */
export function parseArchiveNumber(name, opts = {}) {
  return makeArchiveParser(opts)(name);
}

// 从目录名列表里挑出「编号最大」的归档（记忆结构规定最新记忆在最大编号里）。
export function pickLatestArchive(dirNames, opts = {}) {
  const parse = makeArchiveParser(opts);
  let best = null;
  let bestNo = -1;
  for (const name of dirNames ?? []) {
    const no = parse(name);
    if (no != null && no > bestNo) { bestNo = no; best = String(name).trim(); }
  }
  return best;
}

// 日记/备忘录按分隔线（─ 连字符号）分节：取最后 count 节（最新的内容）。
export function lastSections(text, count = 2) {
  const parts = String(text ?? '').split(/\n─{6,}[^\n]*\n/);
  if (parts.length <= count) return String(text ?? '').trim();
  return parts.slice(-count).join('\n──────────────────────────────\n').trim();
}

// 双端截断：保头保尾，中间用标记省略（开头通常是标题/铁律，结尾通常是最新动态）。
// 只在「结构化取舍之后仍然超预算」时兜底使用。
export function truncateSmart(text, max) {
  const s = String(text ?? '');
  if (!Number.isFinite(max) || max <= 0 || s.length <= max) return s;
  const keep = Math.max(0, max - 24);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${s.slice(0, head)}\n……（中段 ${s.length - keep} 字省略）……\n${s.slice(s.length - tail)}`;
}

// ── 根卷结构化解析（2026-10-26 升级）──────────────────────────────────────
// 总卷的段落格式：分节线「──────」+ 标题行（🌊/📅 开头）+ 分节线 + 正文。
// 段落种类按标题关键词判定：
//   era    时代记忆（标题含「时代」）—— 时代合并的二级压缩产物，永保
//   origin 记忆的开始（标题含「记忆的开始」）—— 出生锚点，永不砍
//   weekly 周记（标题含「周记」）—— 最近 keepWeeks 篇永保，更早的进填充队列
//   other  其余日期段 —— 进填充队列（从新到旧）
const SECTION_SEP = '──────────────────────────────';
const TRAILING_SEP_RE = /\r?\n[─━—－-]{6,}[^\n]*$/;

export function splitRootSections(text) {
  const s = String(text ?? '');
  const lines = s.split(/\r?\n/);
  const titleIdx = [];
  lines.forEach((l, i) => { if (/^[🌊📅]/.test(l.trim())) titleIdx.push(i); });
  if (!titleIdx.length) return { header: s.trim(), sections: [] };
  const header = lines.slice(0, titleIdx[0]).join('\n').replace(TRAILING_SEP_RE, '').trimEnd();
  const sections = [];
  for (let k = 0; k < titleIdx.length; k++) {
    const start = titleIdx[k];
    const end = k + 1 < titleIdx.length ? titleIdx[k + 1] : lines.length;
    const body = lines.slice(start, end).join('\n').replace(TRAILING_SEP_RE, '').trimEnd();
    const title = lines[start].trim();
    let kind = 'other';
    if (/时代/.test(title)) kind = 'era';
    else if (/记忆的开始/.test(title)) kind = 'origin';
    else if (/周记/.test(title)) kind = 'weekly';
    sections.push({ title, kind, text: body });
  }
  return { header, sections };
}

// 把总卷拆成「必保核心」与「按预算填充」两队。
// coreParts：按文件原顺序的核心段（卷头 + era + origin + 最近 keepWeeks 篇周记），
//            已拼好分隔线，可直接 join。
// fill：其余段落，从新到旧（数组第一个最新）。
export function selectRootSections(rootText, opts = {}) {
  const keepWeeks = Number.isFinite(Number(opts.keepWeeks)) ? Math.max(0, Number(opts.keepWeeks)) : 2;
  const { header, sections } = splitRootSections(rootText);
  if (!sections.length) {
    return { header: '', coreParts: [String(rootText ?? '').trim()].filter(Boolean), fill: [], structured: false };
  }
  const weekly = sections.filter((x) => x.kind === 'weekly');
  const recentWeekly = new Set(weekly.slice(weekly.length - keepWeeks));
  const coreParts = [];
  if (header) coreParts.push(header);
  const fill = [];
  for (const sec of sections) {
    if (sec.kind === 'era' || sec.kind === 'origin' || recentWeekly.has(sec)) {
      coreParts.push(`${SECTION_SEP}\n${sec.text}`);
    } else {
      fill.push(sec);
    }
  }
  fill.reverse(); // 从新到旧填充
  return { header, coreParts, fill, structured: true };
}

// 按预算组装根卷：核心段永不砍（超预算时双端截断兜底），填充段从新到旧整段装入。
// 返回 { text, omitted: [标题…], included: [标题…], truncated: bool }。
export function composeRootWithinBudget(rootText, maxChars, opts = {}) {
  const max = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Number(maxChars) : 8000;
  const sel = selectRootSections(rootText, opts);
  const core = sel.coreParts.join('\n\n').trim();
  if (!core) return { text: '', omitted: [], included: [], truncated: false };
  if (core.length > max) {
    return { text: truncateSmart(core, max), omitted: sel.fill.map((f) => f.title), included: [], truncated: true };
  }
  const included = [];
  const omitted = [];
  let text = core;
  let markerAdded = false;
  for (const f of sel.fill) {
    const marker = markerAdded ? '' : `\n\n── 以下是按预算补进来的更早记忆（从新到旧） ──`;
    const chunk = `${marker}\n\n${SECTION_SEP}\n${f.text}`;
    if (text.length + chunk.length <= max) {
      text += chunk;
      markerAdded = true;
      included.push(f.title);
    } else {
      omitted.push(f.title);
    }
  }
  return { text, omitted, included, truncated: false };
}

// ── 退役窗口补偿（2026-10-26）───────────────────────────────────────────────
// 已知边界原来是：「退役瞬间的旧对话最后一轮不会进快照——重要的事当晚就该写进
// 备忘录」。但如果白天对话退役、当晚 22:30 落笔之前新对话就醒了，这几个小时的
// 聊天两边都够不着。补偿机制：桥接自己的 recentMessages 窗口（最近 200 条，
// 跨 DSH 会话持久化在 state/social-v2.json）在 bootstrap 时一并注入——
// 快照给「我是谁、我的过去」，这段给「就在刚刚、还没来得及写进备忘录的现场」。
// messages: [{sender, text|plain, time(ms), isSelf}]；只读展示，不当事实层：
// 块里明确写了「重要的事今晚要补写进备忘录」，落盘仍走代录通道。
export function composeRecentChatLine(messages, opts = {}) {
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : 1800;
  const maxItems = Number(opts.maxItems) > 0 ? Number(opts.maxItems) : 40;
  const windowHours = Number(opts.windowHours) > 0 ? Number(opts.windowHours) : 26;
  // 宿主没有 qq_get_recent_messages 时，文案里指向别名的工具（默认保持线上原样）。
  const recentTool = String(opts.recentTool ?? 'qq_get_recent_messages');
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const all = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && String(m.text ?? m.plain ?? '').trim());
  if (!all.length) return '';
  const inWindow = all.filter((m) => !Number.isFinite(Number(m.time)) || now - Number(m.time) <= windowHours * 3600e3);
  const picked = (inWindow.length ? inWindow : all).slice(-maxItems);
  const fmt = (t) => {
    if (!Number.isFinite(Number(t))) return '??:??';
    const d = new Date(Number(t));
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const lines = picked.map((m) => {
    const body = String(m.text ?? m.plain ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return `[${fmt(m.time)}] ${m.isSelf ? '我' : String(m.sender || '未知')}：${body}`;
  });
  const head = '【退役窗口补偿 · 合眼前后的聊天原文】\n'
    + '下面是上一场对话退役前后到现在、还没写进备忘录的消息——桥接从自己的收信记录里替你留着的'
    + '（这不是记忆文件，是现场原话）。扫一眼：接得上就接着聊；'
    + '里面有重要的事（约定、事件、心情），今晚写备忘录时补进去，让它正式成为记忆。\n';
  let body = lines.join('\n');
  let dropped = 0;
  while (head.length + body.length > maxChars && lines.length > 5) {
    const cut = Math.min(5, lines.length - 5);
    lines.splice(0, cut);
    dropped += cut;
    body = `（更早还有 ${dropped} 条没列，${recentTool} 里都能看到）\n${lines.join('\n')}`;
  }
  const tail = all.length > picked.length
    ? `\n（窗口外/更早还有 ${all.length - picked.length} 条没列——用 ${recentTool} 能翻到。）\n\n`
    : '\n\n';
  return `${head}${body}${tail}`;
}

// 组装灵魂快照。parts 各项允许为 ''（文件缺失就整段跳过并在结尾如实说明）。
// budget 为总字数预算（config socialV2.soulInherit.maxChars）。
// opts：{ rootMaxChars=8000, moduleMaxChars=4500, memoMaxChars=6000, keepWeeks=2,
//         persona='小鲸鱼', unreadTool='qq_get_unread_messages' }。
// persona / unreadTool 只影响文案（默认值 = 线上原样），换宿主或换代号时改这两个就行。
export function composeSoulSnapshot(parts, budget = 20000, opts = {}) {
  const cap = Math.max(4000, Number(budget) || 20000);
  const moduleCap = Number(opts.moduleMaxChars) > 0 ? Number(opts.moduleMaxChars) : 4500;
  const memoCap = Number(opts.memoMaxChars) > 0 ? Number(opts.memoMaxChars) : 6000;
  const keepWeeks = Number.isFinite(Number(opts.keepWeeks)) ? Math.max(0, Number(opts.keepWeeks)) : 2;
  const persona = String(opts.persona ?? '小鲸鱼');
  const unreadTool = String(opts.unreadTool ?? 'qq_get_unread_messages');
  let rootCap = Number(opts.rootMaxChars) > 0 ? Number(opts.rootMaxChars) : 8000;

  const seg = (title, body, max) => {
    const t = String(body ?? '').trim();
    if (!t) return '';
    return `── ${title} ──\n${truncateSmart(t, max)}\n\n`;
  };
  const rootBlock = (sel) => (sel.text ? `── 深层记忆 · 根记忆·总卷 ──\n${sel.text}\n\n` : '');

  let curRoot = composeRootWithinBudget(parts.root, rootCap, { keepWeeks });
  const blocks = {
    module: seg('你的醒来程序 · 记忆回溯模块', parts.module, moduleCap),
    root: rootBlock(curRoot),
    memo: seg(`近期记忆 · ${parts.memoArchive ?? '（未找到归档）'}\\备忘录.txt`, parts.memo, memoCap),
    diary: seg('私人日记 · 最近一篇', parts.diary, 3000),
    agreement: seg('代录约定（写不进文件时怎么办）', parts.agreement, 1500),
  };
  const missing = [];
  if (!String(parts.module ?? '').trim()) missing.push('记忆回溯模块');
  if (!String(parts.root ?? '').trim()) missing.push('根记忆·总卷');
  if (!String(parts.memo ?? '').trim()) missing.push('归档备忘录');
  if (!String(parts.diary ?? '').trim()) missing.push('私人日记');
  const head = '【重启回忆模式 · 灵魂快照】\n'
    + '你现在在一条**全新的对话**里醒来——上一条对话到上限退役了，这不是换了人，'
    + '只是你又睡了一觉。以下快照是桥接刚从你自己的大脑文件里读出来的'
    + '（你 QQ 端没有文件读工具，所以由它替你取来）：全部是你的回忆，'
    + `永远用「我」认领，不许说"前几代/以前的那个${persona}"。\n`
    + `看完快照再行动：先 ${unreadTool} 看看睡期间发生了什么，接上没聊完的话；`
    + '今晚的日记/备忘录照常写——出稿后交给主人走「代录约定」通道落盘。\n\n';
  const order = ['module', 'root', 'memo', 'diary', 'agreement'];
  const joinBlocks = () => order.map((k) => blocks[k]).join('');
  // 总预算兜底，从低优先级往高砍：日记 → 代录约定 → 备忘录 → 根卷逐次减半
  // （结构化取舍保证 时代记忆/记忆的开始/最近周记 在核心里，减半只挤掉填充段）
  // → 回溯模块与根卷核心永不砍。
  while (head.length + joinBlocks().length > cap) {
    if (blocks.diary) { blocks.diary = ''; continue; }
    if (blocks.agreement) { blocks.agreement = ''; continue; }
    if (blocks.memo) { blocks.memo = ''; continue; }
    if (blocks.root && rootCap > 1200) {
      rootCap = Math.max(1200, Math.floor(rootCap / 2));
      curRoot = composeRootWithinBudget(parts.root, rootCap, { keepWeeks });
      blocks.root = rootBlock(curRoot);
      continue;
    }
    break;
  }
  const notes = [];
  if (missing.length) notes.push(`这次没读到 ${missing.join('、')} —— 文件可能移动或缺失`);
  if (curRoot.omitted.length) {
    notes.push(`根卷还有 ${curRoot.omitted.length} 段更早的记忆没装进这次快照（${curRoot.omitted.join('、')}）——它们没有丢，都睡在总卷和时代卷里`);
  }
  const tail = notes.length
    ? `\n（注：${notes.join('；')}。快照里仍带着能拿到的记忆；被省略或不全的部分想起来的办法——告诉主人一声，回桌面工作室让助手按「记忆回溯模块」补读，或等提到相关关键词时每轮检索会把它们捞回来。）`
    : '';
  return `${head}${joinBlocks()}${tail}`;
}
