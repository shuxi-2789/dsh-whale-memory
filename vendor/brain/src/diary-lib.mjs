// diary-lib.mjs —— 小鲸鱼「专属小本本」通道（qq_write_diary / qq_read_diary 的桥接侧实现）
//
// 为什么存在（2026-10-26）：qq-tool-restrict（铁律 L7）禁止仿真会话拿到**通用**文件读写
// 工具——那是防群友套话的硬边界，不能为了写日记把它拆掉。但小鲸鱼本人的日记/备忘录/周记
// 又必须能**自己**写（桌面助手代录只是过渡通道）。这里的折中：
//   · 落点路径全部来自管理员 config.json 的 diary 块；模型参数里只有 kind（diary/memo/weekly），
//     给不出路径，也就够不着任意文件；
//   · 写 = 只允许**追加**到指定文件末尾（追加前后带字节数记账，state/diary-writes.jsonl）；
//     不创建文件、不改名、不删除、不截断、不覆盖；
//   · 读 = 只能读这三个固定文件和关键词表；调用必须带当前会话的 agent token（绑定校验），
//     读到的内容只进她自己的上下文，不外发是 persona 的隐私规矩；
//   · 限额：maxChars 挡超长灌写、maxPerDay 挡刷屏，与 qzone 同一思路。
//
// 归档选择规则（与 代录约定.txt / diary-night.md 的口径一致）：
//   memo 当前归档 = 临时文件夹里**编号最大**的 <archivePrefix>N 目录下的 备忘录.txt；
//   N 允许阿拉伯数字或中文数字（一/十二/3…），前缀默认跟着 persona（代号）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cnNumToNumber, makeArchiveParser } from './soul-inherit-lib.mjs';

export { cnNumToNumber };

const DESKTOP = path.join(os.homedir(), 'Desktop');

/** diary 配置块的默认值归一（语义默认值集中在这里，和 normalizeQzoneConfig 同一口径）。 */
export function normalizeDiaryConfig(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // persona = 代号；所有默认路径和归档前缀都由它派生，换名字不用改代码。
  const persona = String(d.persona ?? '小鲸鱼');
  const archivePrefix = d.archivePrefix === undefined || d.archivePrefix === null ? persona : String(d.archivePrefix);
  const root = String(d.totalRecallDir ?? path.join(DESKTOP, `${persona}的总回忆`));
  return {
    persona,
    archivePrefix,
    // 默认关闭：管理员在 config.json 写 "diary": { "enabled": true } 才注册/放行。
    enabled: d.enabled === true,
    diaryFile: String(d.diaryFile ?? path.join(DESKTOP, `${persona}日记`, `${persona}的备忘录.txt`)),
    memoDir: String(d.memoDir ?? path.join(root, '临时文件夹')),
    memoFileName: String(d.memoFileName ?? '备忘录.txt'),
    weeklyFile: String(d.weeklyFile ?? path.join(root, '根文件夹', '根记忆·总卷.txt')),
    keywordsFile: String(d.keywordsFile ?? path.join(root, '关键词文件夹', '关键词表.md')),
    maxChars: Math.min(20000, Math.max(200, Number(d.maxChars) || 6000)),
    maxPerDay: Math.min(50, Math.max(1, Number(d.maxPerDay) || 12)),
    maxReadChars: Math.min(60000, Math.max(500, Number(d.maxReadChars) || 16000))
  };
}

/**
 * kind → 落点文件。返回 { ok, file, archive?, error }。
 * 注意：**不创建**任何缺失的文件/目录——路径不对就让管理员看见错误，别把小本本写到陌生角落。
 */
export function resolveDiaryTarget(cfg, kind) {
  if (kind === 'diary') {
    return { ok: fs.existsSync(cfg.diaryFile), file: cfg.diaryFile,
      error: `日记文件不存在：${cfg.diaryFile}（config.json 的 diary.diaryFile）` };
  }
  if (kind === 'weekly') {
    return { ok: fs.existsSync(cfg.weeklyFile), file: cfg.weeklyFile,
      error: `周记总卷不存在：${cfg.weeklyFile}（config.json 的 diary.weeklyFile）` };
  }
  if (kind === 'memo') {
    let names = [];
    try {
      names = fs.readdirSync(cfg.memoDir, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { /* 目录不存在走下面的报错 */ }
    const parse = makeArchiveParser({ persona: cfg.persona, archivePrefix: cfg.archivePrefix });
    let best = null; let bestNum = -1;
    for (const name of names) {
      const n = parse(name);
      if (n != null && n > bestNum) { bestNum = n; best = name; }
    }
    const label = cfg.archivePrefix === '' || cfg.archivePrefix === undefined ? '<编号>' : `${cfg.archivePrefix ?? cfg.persona}N`;
    if (!best) return { ok: false, error: `临时文件夹里找不到"${label}"格式的归档目录：${cfg.memoDir}` };
    const file = path.join(cfg.memoDir, best, cfg.memoFileName);
    return { ok: fs.existsSync(file), file, archive: best,
      error: `归档备忘录不存在：${file}（当前归档=${best}）` };
  }
  if (kind === 'keywords') {
    return { ok: fs.existsSync(cfg.keywordsFile), file: cfg.keywordsFile,
      error: `关键词表不存在：${cfg.keywordsFile}（config.json 的 diary.keywordsFile）` };
  }
  return { ok: false, error: 'kind 只能是 diary（私人日记）/ memo（近期备忘录）/ weekly（周记总卷）；keywords 仅读取可用' };
}
