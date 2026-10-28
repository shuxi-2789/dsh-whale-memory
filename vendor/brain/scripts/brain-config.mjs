// 大脑配置的统一读取口（2026-10-27 · 可移植性补强）。
// 规则：config.json 的 socialV2.soulInherit 为默认值，环境变量可逐个覆盖 ——
// 这样"拿别人的大脑目录跑一遍我的脚本"不用改任何配置文件：
//   BRAIN_DIR / DIARY_DIR / PERSONA / ARCHIVE_PREFIX
// Windows 下 config.json 常带 UTF-8 BOM（与 bridge.js readJsonSafe 同款容错）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

/** 相对路径按 rootDir 解析（发布版配置写 "./brain-template"，观众不用改绝对路径）。 */
export function resolvePath(rootDir, p) {
  const s = String(p ?? '').trim();
  if (!s) return '';
  return path.isAbsolute(s) ? s : path.resolve(rootDir, s);
}

/** 命令行参数也能覆盖配置（跨平台，比环境变量好打字）：
 *  --brain <目录> --diary <目录> --persona <代号> --archive-prefix <前缀，空值写 ""） */
function argFlags(argv = process.argv.slice(2)) {
  const get = (...names) => {
    for (const n of names) { const i = argv.indexOf(`--${n}`); if (i > -1) return String(argv[i + 1] ?? ''); }
    return undefined;
  };
  const out = {};
  const brain = get('brain', 'brain-dir'); if (brain !== undefined) out.BRAIN_DIR = brain;
  const diary = get('diary', 'diary-dir'); if (diary !== undefined) out.DIARY_DIR = diary;
  const persona = get('persona'); if (persona !== undefined) out.PERSONA = persona;
  const prefix = get('archive-prefix', 'archive_prefix'); if (prefix !== undefined) out.ARCHIVE_PREFIX = prefix;
  return out;
}

/** 读大脑配置。rootDir 默认 = 本文件的上一级（scripts/ 的父目录，即 code/ 或 qq-bridge/）。 */
export function loadBrainConfig(rootDir = path.resolve(HERE, '..')) {
  const flags = argFlags();
  const env = { ...process.env, ...flags };
  const cfg = readJsonSafe(path.join(rootDir, 'config.json')) ?? {};
  const s = cfg?.socialV2?.soulInherit ?? {};
  const brainDir = resolvePath(rootDir, env.BRAIN_DIR || s.brainDir || '');
  const diaryDir = resolvePath(rootDir, env.DIARY_DIR || s.diaryDir || '');
  // persona = 代号；archivePrefix = 归档目录名前缀，默认跟 persona（「归档」→ 归档一、归档二…）。
  // 显式传空串 = 任意前缀，只要目录名结尾是编号就认。
  const persona = String(env.PERSONA || s.persona || '小鲸鱼');
  const archivePrefix = env.ARCHIVE_PREFIX !== undefined
    ? String(env.ARCHIVE_PREFIX)
    : (s.archivePrefix === undefined || s.archivePrefix === null ? persona : String(s.archivePrefix));
  const emoji = s.emoji === undefined || s.emoji === null ? '🐋' : String(s.emoji);
  const out = {
    cfg,
    soul: s,
    perTurn: s.perTurn ?? {},
    brainDir,
    diaryDir,
    persona,
    archivePrefix,
    emoji,
    // 直接可以传给 parseArchiveNumber / pickLatestArchive / makeArchiveParser
    archiveOpts: { persona, archivePrefix },
    docOpts: { persona, emoji },
    /** 缺大脑目录就退出（脚本的统一行为，报错说清两条修法）。 */
    requireBrain() {
      if (!brainDir || !fs.existsSync(brainDir)) {
        console.error(`大脑目录不存在：${brainDir || '(未配置)'}\n  改 code/config.json 的 socialV2.soulInherit.brainDir，或临时设环境变量 BRAIN_DIR=...`);
        process.exit(1);
      }
      return brainDir;
    },
  };
  return out;
}
