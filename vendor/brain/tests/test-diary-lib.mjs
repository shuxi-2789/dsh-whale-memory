#!/usr/bin/env node
// 小本本通道（qq_write_diary / qq_read_diary 的落点解析）回归。
// 2026-10-27 重点：归档目录名前缀可配置 —— 换代号/换「归档一」这种命名不再需要改代码。
// 用法：node tests/test-diary-lib.mjs   （默认对着 code/config.json + brain-template 跑；
//        也可 BRAIN_DIR=... PERSONA=... ARCHIVE_PREFIX=... 覆盖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDiaryConfig, resolveDiaryTarget, cnNumToNumber } from '../src/diary-lib.mjs';
import { loadBrainConfig } from '../scripts/brain-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`OK   ${name}`); } else { fail++; console.log(`FAIL ${name}`); } };

const brain = loadBrainConfig(ROOT);
const soul = brain.soul;
const brainDir = brain.brainDir;
const persona = brain.persona;
const archivePrefix = brain.archivePrefix;

// ── 中文/阿拉伯数字 ──
check('十二=12', cnNumToNumber('十二') === 12);
check('二十三=23', cnNumToNumber('二十三') === 23);
check('一百=100', cnNumToNumber('一百') === 100);
check('3=3', cnNumToNumber('3') === 3);
check('空串=-1', cnNumToNumber('') === -1);

// ── 默认值随 persona 派生（不再是别的人的桌面路径）──
{
  const d = normalizeDiaryConfig({ persona: '小雪' });
  check('persona 进配置', d.persona === '小雪');
  check('归档前缀默认跟 persona', d.archivePrefix === '小雪');
  check('总回忆默认路径带代号', d.totalRecallDir === undefined && d.weeklyFile.includes('小雪的总回忆'), d.weeklyFile);
  check('日记默认路径带代号', d.diaryFile.includes('小雪日记') && d.diaryFile.includes('小雪的备忘录.txt'), d.diaryFile);
  const d0 = normalizeDiaryConfig({});
  check('默认 persona=小鲸鱼（线上零变化）', d0.persona === '小鲸鱼' && d0.archivePrefix === '小鲸鱼' && d0.weeklyFile.endsWith('小鲸鱼的总回忆\\根文件夹\\根记忆·总卷.txt'.replace(/\\/g, path.sep)));
  const d1 = normalizeDiaryConfig({ persona: '小雪', archivePrefix: '归档' });
  check('archivePrefix 显式覆盖 persona', d1.archivePrefix === '归档');
  const d2 = normalizeDiaryConfig({ archivePrefix: '' });
  check('archivePrefix 空串=任意编号结尾', d2.archivePrefix === '');
}

// ── memo 落点：按可配置前缀挑编号最大的归档 ──
{
  const mk = (prefix, dir = brainDir) => normalizeDiaryConfig({
    enabled: true, persona, archivePrefix: prefix, totalRecallDir: dir,
    memoDir: path.join(dir, '临时文件夹'),
  });
  if (!brainDir || !fs.existsSync(path.join(brainDir, '临时文件夹'))) {
    console.log(`SKIP 没有临时文件夹（${brainDir}），归档解析断言跳过`);
  } else {
    const t = resolveDiaryTarget(mk(archivePrefix), 'memo');
    check(`按前缀 ${JSON.stringify(archivePrefix)} 认出当前归档`, t.ok === true && !!t.archive, t.error || JSON.stringify(t));
    check('备忘录文件确实存在', t.ok && fs.existsSync(t.file), t.file);
    const wrong = resolveDiaryTarget(mk('不存在的代号'), 'memo');
    check('前缀不匹配时如实报错、不瞎猜归档', wrong.ok === false && /找不到/.test(wrong.error), wrong.error);
    const any = resolveDiaryTarget(mk(''), 'memo');
    check('空前缀模式也能认出归档', any.ok === true && !!any.archive, any.error);
  }
  // 其他三类落点（日记文件名三条候选路径都试：显式 diaryFileName → <persona>的备忘录.txt → 私人日记.txt）
  const diaryDir = brain.diaryDir;
  const diaryCandidates = [
    soul.diaryFileName && path.join(diaryDir, String(soul.diaryFileName)),
    path.join(diaryDir, `${persona}的备忘录.txt`),
    path.join(diaryDir, '私人日记.txt'),
  ].filter(Boolean).find((p) => fs.existsSync(p));
  const base = normalizeDiaryConfig({
    enabled: true, persona, archivePrefix, totalRecallDir: brainDir,
    diaryFile: diaryCandidates,
    keywordsFile: path.join(brainDir, '关键词文件夹', '关键词表.md'),
    weeklyFile: path.join(brainDir, '根文件夹', '根记忆·总卷.txt'),
  });
  if (diaryCandidates) check('diary 落点可写（模板/线上目录）', resolveDiaryTarget(base, 'diary').ok === true);
  else console.log(`SKIP diary 落点：${diaryDir || '(未配置)'} 里没找到候选日记文件`);
  check('weekly 落点可写', resolveDiaryTarget(base, 'weekly').ok === true);
  check('keywords 落点可读', resolveDiaryTarget(base, 'keywords').ok === true);
  check('未知 kind 被拒绝', resolveDiaryTarget(base, 'whatever').ok === false);
  check('配置里的 maxChars/maxPerDay 有边界', base.maxChars <= 20000 && base.maxPerDay <= 50);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
