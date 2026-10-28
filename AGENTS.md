# AGENTS.md —— 给宿主 AI 的插件工作规格（可执行，不是散文）

## 装完的判定（新会话里照这个顺序跑）

1. 工具可见性：本轮会话应能看到 6 个 `whale_*` 工具。看不到 ⇒ DSH 没重启（工具清单在启动时缓存）。
2. `whale_status` → 期望 `ok:true`、`skeleton.brainExists:true`（首次用先按下面「初始化一副大脑」）。
3. `whale_doctor` → 期望 `ok:true`；`data` 里若有红灯项，每条自带修法，修完再跑。
4. `whale_doctor {withTests:true}` → `testsAllGreen:true`（三条回归 × 内置大脑）。
5. `whale_wake` → `text` 非空（灵魂快照，≥ 千把字）。
6. `whale_recall {message:"今天有人夸我了"}` → `ok:true`（`hits` 真假都算绿 —— 查不到是正常结果）。
7. `whale_index` / `whale_tags {mode:"dry"}` → `ok:true`。

任一步不过：停下，如实报告哪一步和返回里的线索，**不要**跳步或自己发明替代方案。

## 初始化一副大脑（L0 骨架缺失时才做）

插件家 `$DSH_HOME/whale-memory/templates/` 里有 `brain-template/` + `diary-template/`。
按 vendor 的原系统规格（`vendor/brain/` 同级仓库的 AGENTS.md §2）复制到 `brainDir`/`diaryDir`，
把 `【代号】` 换成 persona。写完再跑第 2 步验收。

## 红线（任何情况下不得违反）

1. 只读检索为主；唯一允许的写 = 追加段落 / 追加〔标签〕（脚本自带 `.bak`）。
2. 私人日记不参与每轮检索注入；查看遵循 `权限约定.txt`。
3. 梦境文件夹永不参与检索、永不写回其他层。
4. 查不到就说查不到；低置信度块不得改写成"精确记忆"。
5. 不要把真实大脑目录提交进任何公开仓库 / 打包进 npm 发布件（fixtures 是脱敏的假大脑，才可以）。
