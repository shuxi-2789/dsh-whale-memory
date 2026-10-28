# CHANGELOG

## 0.1.2（2026-10-28 · 验收轮实锤两处）

- 🔴 修 `whale_doctor {withTests:true}`：runTest 误去 `scripts/` 找回归脚本（正确是 `tests/`），
  三条回归全报"脚本没铺到家目录"。selfcheck 新增**工具路径**的 withTests 检查（直 spawn 测不出此 bug）。
- 🔴 修 archivePrefix 种子污染：0.1.1 只在 Config 非空时覆盖家 config，样例 config.json 的 `"归档"`
  永远洗不掉 → 真宿主归档叫「小鲸鱼一」时 doctor 红灯。现在留空 = 跟 persona 走（原系统规格）。
- 验收轮（真宿主、真大脑）结果：status/doctor/wake/recall/tags-dry 全过；快照 12303 字；
  召回 hits（联想+SimHash 23/24 距离，低置信度标注正常）。

## 0.1.1（2026-10-28）

- 🔴 修复：真宿主（桌面版）传给 apply() 的 config 字段不是裸字符串 —— 0.1.0 把它们 `String()` 成
  `"[object Object]"` 写进家 config.json。现在所有配置字段只认非空字符串，其余一律回退默认值；
  升级激活时自动用干净值覆盖被污染的身份/路径字段（预算参数不受影响）。
  证据：`$DSH_HOME/whale-memory/brain/config.json` 实跑产物。
- 运行时版本标记随包版本重铺（.synced-version）。

## 0.1.0（2026-10-28）

- 首个形态：「小鲸鱼记忆全系统 v0」L2 层的 DSH 插件壳。
- 6 个 MCP 工具：`whale_status` / `whale_doctor` / `whale_wake` / `whale_recall` / `whale_index` / `whale_tags`。
- 运行时（lib + 脚本 + 回归 + fixtures）vendor 自 whale-memory-brain v0.1.0，铺设到 `$DSH_HOME/whale-memory/brain/`。
- Config：persona / brainDir / diaryDir / archivePrefix / diaryFileName / enabled（volatile，设置可写）。
- selfcheck.mjs：假 ctx 跑 apply + 6 工具真调 + `WHALE_FULL=1` 全套回归。
- 未做（第二周）：设置页 GUI、侧栏可视化、L1 定时例程接线、CI。
