# config.json 的键（L2 层）

线上是把这段嵌在桥接的大 config 里（`socialV2.soulInherit`）；复刻时独立一个 `code/config.json` 就够，
`scripts/*.mjs` 与 `tests/*.mjs` 都按 `ROOT/config.json` 读（ROOT = 本目录）。
带 BOM 的 UTF-8 也能读（脚本里已做剥离）。

```
socialV2.soulInherit
├─ enabled            总开关；false 时 bootstrap 不带快照
├─ persona       '小鲸鱼'  代号：进快照文案与索引卷/候选清单标题，也是归档目录名前缀的默认值
├─ archivePrefix      = persona  归档前缀（「归档」→ 归档一/归档二；"" = 任意名字只要结尾是编号）
├─ emoji         '🐋'  生成文档标题用的小图标，可填 ""
├─ diaryFileName <persona>的备忘录.txt  私人日记文件名
├─ brainDir           大脑根目录（记忆回溯模块.md 所在层）
├─ diaryDir           日记目录（取最近一篇 + 代录约定.txt）
├─ maxChars       20000  灵魂快照总预算；超了按兜底顺序砍段落并如实注明
├─ moduleMaxChars  6000  记忆回溯模块在快照里的上限（模块会随机制升级变长，太小会被双端截断）
├─ rootMaxChars    8000  根卷段的额度（按段取舍在此额度内填充）
├─ keepWeeks          2  根卷里永远保留的最近周记篇数
├─ recentChat         退役窗口补偿
│  ├─ enabled
│  ├─ maxChars     1800  超了从最旧一行行丢并如实注明
│  ├─ maxItems       40
│  └─ windowHours    26  只列最近 N 小时（要盖住"昨天此刻以来"）
└─ perTurn            每轮检索（零 token）
   ├─ enabled
   ├─ maxItems / maxChars   5 / 1200   ① 强关键词块预算
   ├─ semantic                  ②③ 联想层
   │  ├─ enabled
   │  ├─ maxItems / maxChars    3 / 600
   │  └─ minScore               9       模糊召回分数线（≥ 一个 3 字命中，得分按长度平方）
   └─ simhash                   ④ 指纹层
      ├─ enabled
      ├─ maxItems / maxChars    2 / 400  独立小预算
      ├─ maxDistance            24       汉明距离绝对阈值（64 位指纹）
      └─ minGap                  4       自适应间隙：须比全库距离中位数近这么多
```

取样与缓存（写死在代码里，改代码不改配置）：
- 消息取样：最近 8 条他人消息、截尾 600 字；
- 关键词表与记忆文件 30 秒缓存；块指纹随文件缓存跨轮复用（`fpCache`）。

调 `maxDistance` 不要凭感觉，跑探针看分布：
```
node scripts/probe-simhash.mjs "要试的消息文本"
# 看 min / p10 / p50 / max；相关段应在 p10 附近，无关段应在 p50 以上，中间留得开才安全
```

## 环境变量覆盖（不改配置就能换一副大脑试）

`BRAIN_DIR` / `DIARY_DIR` / `PERSONA` / `ARCHIVE_PREFIX` 四个变量优先于 `config.json`，
由 `scripts/brain-config.mjs` 统一读取，四个脚本和三个测试都认。
套件自带一副"别人的大脑"可以直接拿来验：`code/fixtures/小雪的总回忆`（代号小雪、归档前缀「卷宗」）。
