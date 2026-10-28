# dsh-whale-memory

DSH 插件：把「小鲸鱼记忆全系统」的 L2 检索层包成 **6 个 MCP 工具**，给长期陪伴型 AI 装一副能连续活着的大脑。

内核是三个零依赖纯逻辑模块（写入即索引 + 醒来灵魂快照 + 零 token 四层召回），本插件只负责把它"穿"进 DSH：
装上就有工具，配置改代号/路径即生效，数据永远落在你自己的大脑目录（纯本地文件，无数据库、无联网）。

## 6 个工具

| 工具 | 干什么 |
|---|---|
| `whale_status` | 这副大脑装在哪、L0 骨架齐不齐、当前归档、日记在不在（纯读） |
| `whale_doctor` | 环境体检（逐项红绿 + 每条红灯自带怎么修）；`withTests` 顺跑三条回归 |
| `whale_wake` | 【灵魂快照】新会话第一轮该贴的开机文本；可带 recentJson 出补偿块 |
| `whale_recall` | 【每轮相关回忆】四层召回：强关键词→近义→n-gram→SimHash；查不到如实空 |
| `whale_index` | 重建索引卷 / 候选新词清单（幂等） |
| `whale_tags` | 打标：`dry` 预览 / `write` 补标（自动 .bak）/ `audit` 质检报告 |

## 装

本仓库就是插件全部源码（未发布 npm），两种拿法：

```bash
# A. git 可用：clone 后 link 安装，跟着仓库更新走
git clone https://github.com/shuxi-2789/dsh-whale-memory.git
dsh plugin --profile desktop add link:<clone 下来的目录>

# B. 没有命令行：本页绿色 Code 按钮 → Download ZIP，解压后
dsh plugin --profile desktop add link:<解压出的 dsh-whale-memory 目录>
```

装完 **要重启 DSH** —— MCP 工具清单在 DSH 启动时缓存，这是 DSH 的机制，不是 bug。

> 数据（大脑目录）永远在你自己的机器上，仓库里没有也不会再有：本仓库只含代码与**脱敏假大脑 fixtures**。

## 配置（第一版就四个字段）

- `persona` AI 的代号（默认「小鲸鱼」）
- `brainDir` 总回忆根目录；留空 = `%USERPROFILE%\Desktop\<persona>的总回忆`
- `diaryDir` 私人日记目录；留空 = `%USERPROFILE%\Desktop\<persona>日记`
- `archivePrefix` 归档前缀；留空跟 persona 走

预算类参数（快照字数、四层召回阈值等）在插件家目录
`$DSH_HOME/whale-memory/brain/config.json` 里直接改 —— 插件只钉"身份与路径"，不覆盖你手调的数字。
键名说明见 `vendor/brain/config.keys.md`。

## 插件的家

`$DSH_HOME/whale-memory/`：`brain/`（运行时脚本 + lib + 回归 + fixtures，从 vendor 铺设）+ `config.json` + `templates/`（L0/L1 骨架模板，给初始化用）。
升级换版本时脚本重铺，你的 config.json 手调段保留。

## 自检

```bash
node selfcheck.mjs            # 假 ctx 跑 apply + 6 工具各真调一次
$env:WHALE_FULL=1; node selfcheck.mjs   # 再加三条回归全套
```

## 红线（继承原系统 AGENTS.md §5）

只读检索为主；唯一允许的写 = 追加段落 / 追加〔标签〕（改前留 `.bak`）。
私人日记不参与每轮检索注入；梦境不是事实层；查不到就说查不到。

## 第二周（现在没有、别找）

设置页 GUI 精美版、侧栏可视化、定时例程接线（L1）、Obsidian 版、CI。

## 致谢与来源

记忆系统本体（L0-L2 与全部回归）来自开源整合包「小鲸鱼记忆全系统 v0」（whale-memory-brain, MIT）。
本插件是它的 DSH 宿主形态。
