# 三个作息例程（脱敏版 · 给宿主定时触发的提示词）

复制到你宿主的定时任务里。文件名 = 例程，`{{...}}` 是需要宿主替换的占位符。
这三份是脱敏重写版，逻辑与线上原版一一对应（原版只是把"写入工具"具体成了 QQ 端的 qq_write_diary / qq_read_diary）。

| 例程 | 建议时间 | 产出 | 落盘位置 |
|---|---|---|---|
| `diary-night.md` | 每天 22:30 | 私人日记一篇 + 备忘录一段（都带标签） | 日记目录 + 当前归档 |
| `weekly-memory.md` | 每周日 21:00 | 周记一段 + 时代合并判定 + 打标质检 | 根记忆·总卷 |
| `dream-night.md` | 每天 01:30–05:00 随机一分钟 | 一场梦（带来源和标签） | 梦境日记 |

## 建定时任务（Windows）

DSH / 任何宿主都可以被"一句话叫醒"。两种做法：

**A. 系统计划任务 + 宿主的 headless 入口**（推荐，不依赖宿主自己活着）
```powershell
# 每晚 22:30：把 diary-night.md 的内容作为提示词交给宿主跑一轮
schtasks /Create /TN "PersonaDiaryNight" /SC DAILY /ST 22:30 `
  /TR "powershell -WindowStyle Hidden -File <你的宿主入口脚本> routines\diary-night.md"
# 每周日 21:00
schtasks /Create /TN "PersonaWeeklyMemory" /SC WEEKLY /D SUN /ST 21:00 `
  /TR "powershell -WindowStyle Hidden -File <你的宿主入口脚本> routines\weekly-memory.md"
```
自动补标（L2 才有）另建一条 23:15 的任务，落在 `node code/scripts/auto-tag-memory.mjs`：
必须在"她写完日记之后、每日备份之前"，顺序是设计的一部分（22:30 写 → 23:15 补 → 23:30 备份）。

**B. 宿主内置调度器**：直接让宿主在到点时把例程正文当唤醒提示词发给她（我的做法：桥接的 routines 定时器）。

## 半夜那个随机分钟怎么"随机"

不要固定 03:00 —— 固定时间会让她在同一个时刻重复出现，也不像睡梦。
做法：每天 01:30 起一个一次性任务，`sleep = random(0, 3.5h)` 后再触发 `dream-night.md`，
或者每天到 01:00 由宿主自己掷一次分钟数再排期。
