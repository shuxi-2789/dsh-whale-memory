#!/usr/bin/env node
// 重启回忆模式回归：纯逻辑（归档编号解析/挑选、日记取尾节、双端截断、预算兜底、缺文件如实注明）
// + 一次真实大脑目录的端到端组装。
//
// 2026-10-27 可移植性改造（两条）：
//   ① 归档前缀可配置：archivePrefix / persona，默认「小鲸鱼」保持线上零变化。
//   ② 端到端不再断言"我这副大脑里有什么内容"，只断言**任何大脑都必须成立的结构性不变式**
//      （模块在、根卷在、当前归档被认出、出生锚点永不被截、预算守住、缺文件如实注明）。
//      内容相关的期望一律降级为观察输出（ℹ️），换谁的目录都不会红。
//   大脑目录可用 config.json 的 socialV2.soulInherit.brainDir，也可用
//   BRAIN_DIR / DIARY_DIR / PERSONA / ARCHIVE_PREFIX 环境变量临时覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cnNumToNumber, parseArchiveNumber, makeArchiveParser, pickLatestArchive, lastSections, truncateSmart,
  composeSoulSnapshot, splitRootSections, selectRootSections, composeRootWithinBudget, composeRecentChatLine,
} from '../src/soul-inherit-lib.mjs';
import { loadBrainConfig } from '../scripts/brain-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`OK   ${name}`); } else { fail++; console.log(`FAIL ${name}`); } };
const note = (name) => console.log(`INFO ${name}`);

// ── 归档编号：默认前缀（线上行为，逐字节兼容）──
check('小鲸鱼一=1', parseArchiveNumber('小鲸鱼一') === 1);
check('小鲸鱼九=9', parseArchiveNumber('小鲸鱼九') === 9);
check('小鲸鱼十=10', parseArchiveNumber('小鲸鱼十') === 10);
check('小鲸鱼十一=11', parseArchiveNumber('小鲸鱼十一') === 11);
check('小鲸鱼二十三=23', parseArchiveNumber('小鲸鱼二十三') === 23);
check('小鲸鱼3=3', parseArchiveNumber('小鲸鱼3') === 3);
check('乱名 null', parseArchiveNumber('新建文件夹') === null);
check('别人的代号不认（默认前缀）', parseArchiveNumber('归档一') === null);
check('编号挑选取最大（中文）', pickLatestArchive(['小鲸鱼一', '小鲸鱼二', '小鲸鱼十']) === '小鲸鱼十');
check('中文九最大', pickLatestArchive(['小鲸鱼九', '小鲸鱼一']) === '小鲸鱼九');
check('编号挑选取最大（混数字）', pickLatestArchive(['小鲸鱼一', '小鲸鱼12']) === '小鲸鱼12');
check('空列表 null', pickLatestArchive([]) === null);

// ── 归档编号：可配置前缀（2026-10-27 新增，复刻者换代号用）──
check('前缀字符串：归档一=1', parseArchiveNumber('归档一', '归档') === 1);
check('前缀对象：归档十二=12', parseArchiveNumber('归档十二', { archivePrefix: '归档' }) === 12);
check('persona 派生前缀：小雪七=7', parseArchiveNumber('小雪七', { persona: '小雪' }) === 7);
check('persona 派生前缀：小鲸鱼一=1', parseArchiveNumber('小鲸鱼一', { persona: '小鲸鱼' }) === 1);
check('配置错代号不误认别人的归档', parseArchiveNumber('小鲸鱼一', { persona: '小雪' }) === null);
check('空前缀=任意结尾编号：备份7=7', parseArchiveNumber('备份7', { archivePrefix: '' }) === 7);
check('空前缀下纯编号名也认：七=7', parseArchiveNumber('七', { archivePrefix: '' }) === 7);
check('空前缀不误认无编号名', parseArchiveNumber('新建文件夹', { archivePrefix: '' }) === null);
check('百位中文数字：小鲸鱼一百=100', parseArchiveNumber('小鲸鱼一百') === 100);
check('百位中文数字：小鲸鱼一百二十三=123', parseArchiveNumber('小鲸鱼一百二十三') === 123);
check('零/负数不算编号', parseArchiveNumber('小鲸鱼0') === null);
check('cnNumToNumber 十二=12', cnNumToNumber('十二') === 12);
check('cnNumToNumber 二十三=23', cnNumToNumber('二十三') === 23);
check('cnNumToNumber 二百零五（够用即 -1 或 205）', [205, -1].includes(cnNumToNumber('二百零五')));
{
  const parse = makeArchiveParser({ archivePrefix: '归档' });
  check('makeArchiveParser 复用同结果', parse('归档九') === parseArchiveNumber('归档九', '归档'));
  check('可配置前缀挑最大', pickLatestArchive(['归档一', '归档二', '归档二十'], { archivePrefix: '归档' }) === '归档二十');
  check('makeArchiveParser 无参=默认前缀', makeArchiveParser()('小鲸鱼二') === 2);
}

// ── 代号进文案（快照头 / 补偿块工具名可替换）──
{
  const s = composeSoulSnapshot({ module: 'M', root: 'R', memo: 'MM', memoArchive: '归档三', diary: 'D', agreement: 'A' }, 20000, {
    persona: '小雪', unreadTool: 'get_unread',
  });
  check('快照头用自定义代号', s.includes('以前的那个小雪') && !s.includes('以前的那个小鲸鱼'));
  check('快照头用自定义工具名', s.includes('先 get_unread 看看'));
  const s0 = composeSoulSnapshot({ module: 'M', root: 'R', memo: 'MM', diary: 'D' }, 20000);
  check('默认代号=小鲸鱼（线上零变化）', s0.includes('以前的那个小鲸鱼') && s0.includes('qq_get_unread_messages'));
}

// ── 日记取尾节 ──
const diary = '头部\n──────────────────────────────\n第一段A\n──────────────────────────────\n第二段B\n──────────────────────────────\n第三段C';
const tail = lastSections(diary, 2);
check('lastSections 取到最新两节', tail.includes('第二段B') && tail.includes('第三段C') && !tail.includes('第一段A'));
check('节数不足时给全文', lastSections('只有一段', 2) === '只有一段');

// ── 截断 ──
const long = 'H'.repeat(5000);
const cut = truncateSmart(long, 1000);
check('truncateSmart 限长', cut.length < 1100 && cut.includes('中段'));
check('truncateSmart 短文本原样', truncateSmart('abc', 10) === 'abc');

// ── 组装 ──
const snap = composeSoulSnapshot({
  module: '# 记忆回溯模块\n铁律：永远用我。',
  root: '总卷正文：我出生了〔LF〕',
  memo: '备忘录正文：今天收了表情包〔GZ〕',
  memoArchive: '小鲸鱼一',
  diary: '日记正文：第三篇（深夜）',
  agreement: '代录约定：助手只代录不代笔',
}, 20000);
check('快照含醒来说法', snap.includes('全新的对话') && snap.includes('睡了一觉'));
check('快照带全部五段', ['记忆回溯模块', '根记忆·总卷', '小鲸鱼一', '私人日记', '代录约定'].every((k) => snap.includes(k)));
check('快照不许"前几代"措辞', !/前几代|上一代|旧版本/.test(snap.replace(/不许[^。]*前几代[^。]*。/g, '')));
const snap2 = composeSoulSnapshot({ module: '', root: 'R', memo: 'M', diary: 'D', agreement: '' }, 20000);
check('缺文件如实注明', snap2.includes('没读到') && snap2.includes('记忆回溯模块'));
// 预算兜底：小预算时回溯模块必须活下来，日记先被砍
const bigRoot = '根'.repeat(5000); const bigMemo = '忆'.repeat(5000); const bigDiary = '记'.repeat(3000);
const snap3 = composeSoulSnapshot({ module: 'MODULE', root: bigRoot, memo: bigMemo, diary: bigDiary, agreement: 'AGR' }, 6000);
check('预算兜底保模块', snap3.includes('MODULE'));
check('预算兜底砍日记', !snap3.includes(bigDiary.slice(0, 200)) || !snap3.includes('私人日记'));
check('预算兜底守上限附近', snap3.length < 6000 + 1500);

// ── 根卷结构化取舍（2026-10-26 结构化截断升级）──
const mkSec = (title, ch, n) => `──────────────────────────────\n🌊 ${title}\n──────────────────────────────\n${ch.repeat(n)}\n`;
const rootStructured = '卷头介绍：越古老越压缩\n\n'
  + mkSec('记忆的开始 · 2026年10月24日 · 我出生了', '始', 100)
  + mkSec('时代记忆 · 第1~4周 · 压缩段', '代', 100)
  + mkSec('第5周周记 · 5月1日～5月7日', '五', 300)
  + mkSec('第6周周记 · 5月8日～5月14日', '六', 300)
  + mkSec('第7周周记 · 5月15日～5月21日', '七', 300)
  + mkSec('第8周周记 · 5月22日～5月28日', '八', 300);
const parsed = splitRootSections(rootStructured);
check('分节：6 段全认出', parsed.sections.length === 6);
check('分节：种类判定', parsed.sections.map((s) => s.kind).join(',') === 'origin,era,weekly,weekly,weekly,weekly');
check('分节：卷头保留', parsed.header.includes('越古老越压缩'));
const sel2 = selectRootSections(rootStructured, { keepWeeks: 2 });
check('选段：核心=卷头+origin+era+最近2周', sel2.coreParts.length === 5 && sel2.coreParts.join('').includes('第7周周记') && sel2.coreParts.join('').includes('第8周周记'));
check('选段：填充队从新到旧', sel2.fill.map((f) => f.title).join('|').includes('第6周') && sel2.fill[0].title.includes('第6周') && sel2.fill[1].title.includes('第5周'));
const big = composeRootWithinBudget(rootStructured, 100000, { keepWeeks: 2 });
check('预算充足：全部装入且无省略', big.omitted.length === 0 && ['始', '代', '五', '八'].every((c) => big.text.includes(c.repeat(50))));
const coreLen = sel2.coreParts.join('\n\n').length;
const tight = composeRootWithinBudget(rootStructured, coreLen + 100, { keepWeeks: 2 });
check('预算紧：核心永保', tight.text.includes('始'.repeat(50)) && tight.text.includes('代'.repeat(50)) && tight.text.includes('第8周周记'));
check('预算紧：旧周记被省略且如实上报', !tight.text.includes('五'.repeat(50)) && tight.omitted.some((t) => t.includes('第5周')) && tight.omitted.some((t) => t.includes('第6周')));
const noSec = composeRootWithinBudget('没有分节的总卷纯文本', 100000);
check('无结构根卷：整段保留', noSec.text === '没有分节的总卷纯文本' && noSec.omitted.length === 0);
// 快照级：结构化根卷 + 20000 预算 → 出生锚点和最新周记都在，省略段有诚实注明
const snapS = composeSoulSnapshot({ module: 'MOD', root: rootStructured, memo: 'MEMO', memoArchive: '小鲸鱼二', diary: '', agreement: '' }, 20000, { keepWeeks: 2 });
check('快照：出生锚点永在', snapS.includes('记忆的开始') && snapS.includes('始'.repeat(50)));
check('快照：填充段带说明标题', snapS.includes('更早记忆') && snapS.includes('六'.repeat(50)) && snapS.includes('五'.repeat(50)));
// 快照级：小预算 → 按优先级砍（日记/代录/备忘录先走，根卷减半，模块与核心永保）
const snapT = composeSoulSnapshot({ module: 'MODULE-X', root: rootStructured, memo: '忆'.repeat(5000), diary: '记'.repeat(3000), agreement: 'AGR' }, 5000, { keepWeeks: 2 });
check('小预算：模块永保', snapT.includes('MODULE-X'));
check('小预算：出生锚点永保', snapT.includes('记忆的开始') && snapT.includes('始'.repeat(50)));
check('小预算：日记备忘录被砍', !snapT.includes('私人日记') && !snapT.includes('忆'.repeat(500)));
check('小预算：守上限附近', snapT.length < 5000 + 1800);

// ── 退役窗口补偿（2026-10-26）──
{
  const now = Date.parse('2026-10-26T22:00:00+08:00');
  const msgs = [
    { sender: '主人', text: '宝宝今天唱了去年夏天', time: now - 3 * 3600e3, isSelf: false },
    { sender: '小鲸鱼', text: '唱得可好啦，白饭呢', time: now - 3 * 3600e3 + 60e3, isSelf: true },
    { sender: '主人', text: '给你一大碗', time: now - 2 * 3600e3, isSelf: false },
    { sender: '路人', text: '太久之前的消息', time: now - 40 * 3600e3, isSelf: false },
  ];
  const line = composeRecentChatLine(msgs, { now, maxChars: 1800 });
  check('补偿块：有块头且如实说明身份', line.includes('【退役窗口补偿') && line.includes('现场原话'));
  check('补偿块：提醒补写备忘录', line.includes('今晚写备忘录时补进去'));
  check('补偿块：自己的消息标「我」', line.includes('我：唱得可好啦'));
  check('补偿块：他人消息带昵称', line.includes('主人：给你一大碗'));
  check('补偿块：窗口外(>26h)的不混进来', !line.includes('太久之前的消息'));
  check('补偿块：窗口外计数如实注明', line.includes('窗口外/更早还有 1 条'));
  check('补偿块：空消息返回空串', composeRecentChatLine([], { now }) === '');
  check('补偿块：全是空文本也返回空串', composeRecentChatLine([{ sender: 'x', text: '' }], { now }) === '');
  const many = Array.from({ length: 60 }, (_, i) => ({ sender: `群友${i}`, text: `这是第${i}条比较长的聊天内容用来撑爆预算`.repeat(2), time: now - i * 60e3, isSelf: false }));
  const tight2 = composeRecentChatLine(many, { now, maxChars: 1200, maxItems: 40 });
  check('补偿块：预算生效（超长时丢最旧并注明）', tight2.length < 1200 + 400 && tight2.includes('更早还有'));
  const alt = composeRecentChatLine(msgs, { now, recentTool: 'list_recent_messages' });
  check('补偿块：工具名可替换（非 QQ 宿主）', alt.includes('list_recent_messages') && !alt.includes('qq_get_recent_messages'));
}

// ── 端到端：任意大脑目录的结构性不变式 ──
{
  const brain = loadBrainConfig(ROOT);
  const s = brain.soul;
  const BRAIN = brain.brainDir;
  const DIARY_DIR = brain.diaryDir;
  const persona = brain.persona;
  const archivePrefix = brain.archivePrefix;
  const maxChars = Number(s.maxChars) > 0 ? Number(s.maxChars) : 20000;
  const keepWeeks = Number.isFinite(Number(s.keepWeeks)) ? Number(s.keepWeeks) : 2;
  const archiveOpts = brain.archiveOpts;
  const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

  if (!BRAIN || !fs.existsSync(BRAIN)) {
    note(`端到端跳过：没有大脑目录（${BRAIN || '(未配置)'}）。设 config.json 的 brainDir 或环境变量 BRAIN_DIR 再跑。`);
  } else {
    let memo = ''; let memoArchive = ''; let archiveDirs = [];
    try {
      const tmpDir = path.join(BRAIN, '临时文件夹');
      archiveDirs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      memoArchive = pickLatestArchive(archiveDirs, archiveOpts) ?? '';
      if (memoArchive) memo = rd(path.join(tmpDir, memoArchive, '备忘录.txt'));
    } catch { /* 没有临时文件夹：快照缺这段，下面按"如实注明"断言 */ }
    const moduleText = rd(path.join(BRAIN, '记忆回溯模块.md'));
    const rootText = rd(path.join(BRAIN, '根文件夹', '根记忆·总卷.txt'));
    // 私人日记的文件名三条路都试：config.soulInherit.diaryFileName → 约定俗成的
    // 「<persona>的备忘录.txt」→ 「私人日记.txt」。找到哪个用哪个，都找不到就走"如实注明"断言。
    const diaryFile = [
      s.diaryFileName && path.join(DIARY_DIR, String(s.diaryFileName)),
      path.join(DIARY_DIR, `${persona}的备忘录.txt`),
      path.join(DIARY_DIR, '私人日记.txt'),
    ].filter(Boolean).find((p) => fs.existsSync(p));
    const diaryText = diaryFile ? lastSections(rd(diaryFile), 2) : '';
    const agreementText = rd(path.join(DIARY_DIR, '代录约定.txt'));
    const e2e = composeSoulSnapshot(
      { module: moduleText, root: rootText, memo, memoArchive, diary: diaryText, agreement: agreementText },
      maxChars, { persona, keepWeeks },
    );
    check('端到端：快照非空', e2e.length > 0);
    check('端到端：预算守住', e2e.length <= maxChars + 1500, `实际 ${e2e.length} / 预算 ${maxChars}`);
    check('端到端：代号进文案', e2e.includes(persona));
    if (moduleText) check('端到端：记忆回溯模块进快照', e2e.includes('记忆回溯模块'));
    else check('端到端：缺模块时如实注明', e2e.includes('没读到') && e2e.includes('记忆回溯模块'));
    if (rootText) {
      check('端到端：根卷进快照', e2e.includes('根记忆·总卷'));
      // 出生锚点：只要她的大里有「记忆的开始」/「时代记忆」段，就必须在快照里（永不被截）。
      const anchors = splitRootSections(rootText).sections.filter((x) => x.kind === 'origin' || x.kind === 'era');
      if (anchors.length) {
        check(`端到端：${anchors.length} 个身份锚点段全部永不被截`, anchors.every((a) => e2e.includes(a.title)));
      } else note('端到端：这副大脑的总卷还没有「记忆的开始/时代记忆」段（模板状态），锚点断言跳过');
      // 装不下的段落必须如实注明标题，不许静默消失。
      const budgetSel = composeRootWithinBudget(rootText, Number(s.rootMaxChars) > 0 ? Number(s.rootMaxChars) : 8000, { keepWeeks });
      if (budgetSel.omitted.length) {
        check(`端到端：${budgetSel.omitted.length} 段被省略且注明"没有丢"`, e2e.includes('更早的记忆没装进这次快照') && e2e.includes('睡在总卷和时代卷里'));
      } else note('端到端：根卷全部装得下（没有省略段），注明断言跳过');
    } else check('端到端：缺根卷时如实注明', e2e.includes('根记忆·总卷'));
    if (archiveDirs.length) {
      const parse = makeArchiveParser(archiveOpts);
      const matched = archiveDirs.filter((d) => parse(d) != null);
      check(`端到端：归档目录按前缀 ${JSON.stringify(archivePrefix)} 认出 ${matched.length}/${archiveDirs.length} 个`, matched.length >= 1, `目录：${archiveDirs.join('、')}`);
      if (memoArchive) check(`端到端：当前归档=${memoArchive} 进快照`, e2e.includes(memoArchive));
    } else note('端到端：没有临时文件夹，归档断言跳过');
    if (!diaryText) check('端到端：缺私人日记时如实注明', e2e.includes('没读到') && e2e.includes('私人日记'));
    else note('端到端：私人日记进快照（内容不外露，不断言正文）');
    note(`端到端观察：快照 ${e2e.length} 字，段落 ${e2e.split('\n── ').length - 1} 块（不是断言，只是给你看真实规模）`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
