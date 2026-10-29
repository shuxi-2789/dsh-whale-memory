/**
 * dsh-whale-memory —— host 半端
 * ============================================================================
 * 它是什么：把「小鲸鱼记忆全系统」的 L2 检索层（三个零依赖 lib + 七个脚本）
 * 包成 6 个 DSH MCP 工具。任何宿主 AI 装完就能给自己（或她）：
 *   whale_status   —— 看这副大脑装在哪、什么状态（纯读，不开子进程）
 *   whale_doctor   —— 环境体检 + 配置校验（doctor.mjs --json，可顺跑三条回归）
 *   whale_wake     —— 【灵魂快照】：新会话第一轮该贴的开机文本（+可选补偿块/检索块）
 *   whale_recall   —— 【每轮相关回忆】：给一条消息跑四层召回（零 token 本地扫）
 *   whale_index    —— 重建索引卷 / 候选新词清单
 *   whale_tags     —— 打标：dry 预览 / write 补标（自动留 .bak）/ audit 审计
 *
 * 家（`$DSH_HOME/whale-memory/`）里有什么：`brain/`（从 vendor 铺过来的运行时脚本+lib+回归+
 * fixtures，这样用户改的配置、生成的索引都落在家里而不是插件包目录）+ `config.json`
 * （由 Config 铺，路径钉死到她真实的大脑目录）+ `templates/`（L0/L1 模板，初始化骨架用）。
 *
 * 红线（继承 AGENTS.md §5，工具层自己守住）：
 *   只读检索为主；唯一允许的写 = 追加段落 / 追加〔标签〕（脚本自带 .bak）；
 *   查不到就返回空 + 如实标注，绝不硬塞回忆。
 * ============================================================================
 */
import { loadHostDeps } from './lib/hostdeps.mjs'

// ⭐ z / defineTool 从**宿主那棵树**里取（拿不到退到自己依赖；再拿不到 defineTool 用本地等价实现）。
//    原因同 dsh-bili-scroll：桌面版 profile `autoInstallPeers: false`，裸 import optional peer
//    会让整条插件不激活。
const hostDeps = await loadHostDeps()
const z = hostDeps.z
const defineTool = hostDeps.defineTool

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'whale-memory'
// 只要 tools：设置页精美版是第二周的活；现在改代号/路径走 Config（patch / 后续设置页均可写）
export const inject = ['tools']

/**
 * 🔴 每个字段都要 `.extra('volatile', true)`（DSH settings.update 只认 volatile 字段）；
 *    loader entry 的 id 必须等于命名空间名（cordis.patch.yml 里的 'whale-memory'）+ 本模块导出 Config。
 *    —— 三条缺一不可，全抄 dsh-bili-scroll 的已验证口径。
 */
export const Config = !z ? undefined : z.object({
  /** 总开关 */
  enabled: z.boolean().default(true).extra('volatile', true),
  /** AI 的代号（进快照文案、也是归档前缀与默认路径的依据） */
  persona: z.string().default('小鲸鱼').extra('volatile', true),
  /** 总回忆根目录；留空 = %USERPROFILE%\\Desktop\\<persona>的总回忆 */
  brainDir: z.string().default('').extra('volatile', true),
  /** 私人日记目录；留空 = %USERPROFILE%\\Desktop\\<persona>日记 */
  diaryDir: z.string().default('').extra('volatile', true),
  /** 归档前缀；留空 = ""（任意名字只要结尾是编号，归档一/小鲸鱼一 都自动认）；填「归档」→ 只认 归档一/归档二 */
  archivePrefix: z.string().default('').extra('volatile', true),
  /** 日记文件名；留空 = <persona>的备忘录.txt（也可叫 私人日记.txt） */
  diaryFileName: z.string().default('').extra('volatile', true),
})

/**
 * 插件的家：$DSH_HOME/whale-memory/
 * ⚠️ ctx.get('dshHomePath') 返回的是**函数**不是字符串（bili-scroll 2026-10-14 真机踩过）。
 */
function homeOf(ctx) {
  let dir = ''
  try {
    const p = ctx?.get?.('dshHomePath')
    if (typeof p === 'function') {
      const v = p('whale-memory')
      if (v) dir = String(v)
    } else if (typeof p === 'string' && p) {
      dir = join(p, 'whale-memory')
    }
  } catch { /* 拿不到就兜底 */ }
  if (!dir) dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'whale-memory')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function apply(ctx, config) {
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  let myVer = ''
  const myVersion = () => {
    if (myVer) return myVer
    try { myVer = String(JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version || '') } catch { myVer = '' }
    return myVer
  }

  const home = homeOf(ctx)
  const brainHome = join(home, 'brain')
  const log = (m) => { try { ctx.logger?.info?.(m) } catch { /* 没 logger 就算了 */ } }

  /**
   * 🔴 宿主传进来的 config 字段**不保证是字符串**：
   *    2026-10-28 桌面版实测（真宿主铺出的 `~\.dsh\whale-memory\brain\config.json`）里
   *    persona/brainDir/diaryDir/archivePrefix/diaryFileName 全变成 "[object Object]"
   *    —— 说明那一层把 **schema/包装对象** 当成值传给了 apply()。
   *    所以每个配置字段都走这里：只有非空字符串才算数，其余一律回退默认（宁可默认也不要坏值）。
   */
  const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

  /* ─────────────── 家目录铺设（vendor → home，升级时重铺运行时脚本） ─────────────── */

  const needsSync = () => {
    if (!existsSync(join(brainHome, 'scripts', 'doctor.mjs'))) return true
    try { return readFileSync(join(brainHome, '.synced-version'), 'utf8').trim() !== myVersion() } catch { return true }
  }
  if (needsSync()) {
    mkdirSync(brainHome, { recursive: true })
    cpSync(join(pluginDir, 'vendor', 'brain'), brainHome, { recursive: true, force: true })
    writeFileSync(join(brainHome, '.synced-version'), myVersion(), 'utf8')
    log(`whale-memory: 运行时已铺到家（${brainHome}，v${myVersion()}）`)
  }
  // 自愈：坏 config（比如 0.1.0 在桌面版被写进 "[object Object]"）里 persona/brainDir 可能被污染 ——
  // 下面 cfg 段总会用干净值覆盖身份与路径，这里不必单独清。
  // L0/L1 模板（给「装骨架」用；存在就不动，用户改过的东西不覆盖）
  for (const t of ['brain-template', 'diary-template', 'routines']) {
    const dst = join(home, 'templates', t)
    if (!existsSync(dst)) cpSync(join(pluginDir, 'vendor', t), dst, { recursive: true, force: true })
  }

  /* ─────────────── 配置：Config → home/config.json（保留用户手调的预算参数） ─────────────── */

  const persona = str(config?.persona, '小鲸鱼')
  const desktop = join(homedir(), 'Desktop')
  const brainDir = str(config?.brainDir) || join(desktop, `${persona}的总回忆`)
  const diaryDir = str(config?.diaryDir) || join(desktop, `${persona}日记`)
  const archivePrefix = str(config?.archivePrefix)
  const diaryFileName = str(config?.diaryFileName) || `${persona}的备忘录.txt`

  const cfgFile = join(brainHome, 'config.json')
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(cfgFile, 'utf8').replace(/^﻿/, '')) } catch {
    try { cfg = JSON.parse(readFileSync(join(pluginDir, 'vendor', 'brain', 'config.json'), 'utf8').replace(/^﻿/, '')) } catch { cfg = {} }
  }
  cfg.socialV2 = cfg.socialV2 || {}
  const s = (cfg.socialV2.soulInherit = cfg.socialV2.soulInherit || {})
  // Config 只钉「身份与路径」四件套；预算类（maxChars/perTurn/simhash…）用户直接改 config.json，不被覆盖
  s.enabled = config?.enabled !== false
  s.persona = persona
  s.brainDir = brainDir
  s.diaryDir = diaryDir
  s.diaryFileName = diaryFileName
  // 🔴 0.1.2（selfcheck 二修）：archivePrefix **总是覆盖**——0.1.1 只在非空时写，样例种子的"归档"
  //    永远洗不掉（真宿主归档叫「小鲸鱼一」时 doctor 红灯，验收实锤）。留空 = 写 ""，
  //    按原系统规格 "" = 任意名字只要结尾是编号 → 模板的 归档一 和真脑的 小鲸鱼一 同时认。
  s.archivePrefix = archivePrefix
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8')

  /** 给每个子进程统一环境：路径/代号走环境变量覆盖（brain-config.mjs 认这四个） */
  const brainEnv = (extra = {}) => ({
    ...process.env,
    BRAIN_DIR: brainDir,
    DIARY_DIR: diaryDir,
    PERSONA: persona,
    ...(archivePrefix ? { ARCHIVE_PREFIX: archivePrefix } : {}),
    ...extra,
  })

  /** 跑一个 brain 里的脚本（默认 scripts/，回归传 sub='tests'）；返回 { code, out, err }（UTF-8，超时兜底） */
  const run = (script, args = [], timeoutMs = 120000, sub = 'scripts') => new Promise((resolve) => {
    const file = join(brainHome, sub, script)
    if (!existsSync(file)) return resolve({ code: -1, out: '', err: `脚本没铺到家目录：${file}` })
    const child = spawn(process.execPath, [file, ...args], { cwd: brainHome, env: brainEnv(), windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { child.kill() } catch { /* 已退 */ } }, timeoutMs)
    child.stdout.on('data', (b) => { out += String(b) })
    child.stderr.on('data', (b) => { err += String(b) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: `${err}\nspawn 失败：${e?.message || e}` }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
  })

  /** 跑一个 tests 里的回归；返回 { name, passed, failed, tail }（🔴 0.1.1 实锤 bug：曾误走 scripts/ 目录） */
  const runTest = (script) => run(script, [], 180000, 'tests').then(({ code, out, err }) => {
    const all = `${out}\n${err}`
    const m = all.match(/(\d+)\s+passed[^0-9]*?(\d+)\s+failed/i)
    return {
      name: script,
      exitCode: code,
      passed: m ? Number(m[1]) : undefined,
      failed: m ? Number(m[2]) : (code === 0 ? 0 : undefined),
      tail: all.trim().split('\n').slice(-6).join('\n'),
    }
  })

  /* ─────────────── 工具 ─────────────── */

  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_args, value) => [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  }

  /** 宿主只吃"无损 JSON"（函数/循环引用会报 not lossless JSON —— bili-scroll 2026-10-14 踩过） */
  const safe = (v) => {
    if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
  }

  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: spec.output || textOutput,
    async execute(args, exec) { return safe(await spec.execute(args, exec)) },
  }))

  /** 解析脚本的 --json 输出；解析不了就原样带回落 */
  const parseJson = (r) => {
    if (r.code === 0 && r.out.trim()) {
      try { return { ok: true, data: JSON.parse(r.out) } } catch { /* 落到下面 */ }
    }
    return { ok: false, data: null, raw: r.out || r.err, exitCode: r.code, stderr: r.err || undefined }
  }

  // ① 状态：这副大脑装在哪、什么状况（纯读 fs，不开子进程）
  tool({
    name: 'whale_status',
    description: '看记忆系统当前的落位与状态：大脑目录在哪、L0 骨架齐不齐（7 文件 4 目录）、当前归档编号、日记文件在不在、插件家在哪。只读。',
    parameters: {},
    async execute() {
      const leaf = (p) => { try { return existsSync(p) } catch { return false } }
      const b = brainDir
      const expectedFiles = ['记忆回溯模块.md', join('关键词文件夹', '关键词表.md'), join('关键词文件夹', '索引卷.md'),
        join('根文件夹', '根记忆·总卷.txt'), join('临时文件夹', '备忘录.txt'), join('梦境文件夹', '梦境日记.txt')]
      const skeleton = { brainExists: leaf(b), diaryExists: leaf(diaryDir) }
      if (skeleton.brainExists) {
        skeleton.files = expectedFiles.filter((f) => f !== join('临时文件夹', '备忘录.txt') && leaf(join(b, f))).length + ' 项核心文件在位'
        try {
          const tmp = join(b, '临时文件夹')
          const arch = existsSync(tmp) ? readdirSync(tmp, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []
          skeleton.archives = arch
          const memo = arch.map((a) => join(tmp, a, '备忘录.txt')).find(leaf)
          skeleton.memoFile = memo || null
        } catch { /* 读不了就如实缺省 */ }
      }
      skeleton.diaryFile = leaf(join(diaryDir, diaryFileName)) ? join(diaryDir, diaryFileName)
        : (leaf(join(diaryDir, '私人日记.txt')) ? join(diaryDir, '私人日记.txt') : null)
      return {
        ok: true,
        version: myVersion(),
        persona,
        brainDir,
        diaryDir,
        home,
        hostDeps: hostDeps.notes,
        skeleton,
        hint: skeleton.brainExists ? '大脑在位。第一次用先跑 whale_doctor。若主人之前已有几个月聊天记录想搬进来，读仓库 docs/MIGRATION.md 按路线 B 蒸馏回填（只追加、别改写、写完跑 whale_index）。' : '大脑目录不存在 —— 按 README 把 vendor 模板铺成 L0 骨架，或在设置里改 brainDir。',
      }
    },
  })

  // ② 体检：doctor +（可选）三条回归
  tool({
    name: 'whale_doctor',
    description: '环境体检：逐项红绿 + 每条红灯自带怎么修（doctor.mjs --json）。withTests=true 时再跑三条回归（soul-inherit / memory-scan / diary-lib，对着内置模板与小雪 fixtures 各一遍），全绿才算开箱能跑。',
    parameters: {
      withTests: { type: 'boolean', description: '是否顺跑回归（较慢，默认只跑 doctor）' },
    },
    async execute(args) {
      const d = parseJson(await run('doctor.mjs', ['--json']))
      const base = { ok: d.ok, doctor: d.ok ? d.data : { raw: d.raw, exitCode: d.exitCode, stderr: d.stderr } }
      if (!base.ok) return base
      if (args?.withTests) {
        const tests = []
        for (const script of ['test-soul-inherit.mjs', 'test-memory-scan.mjs', 'test-diary-lib.mjs']) tests.push(await runTest(script))
        base.tests = tests
        base.testsAllGreen = tests.every((t) => t.exitCode === 0 && (t.failed === 0 || t.failed === undefined))
      }
      return base
    },
  })

  // ③ 灵魂快照：新会话第一轮贴的开机文本
  tool({
    name: 'whale_wake',
    description: '生成【灵魂快照】—— 新会话第一轮该贴给她醒来的文本（五源组装：回溯模块/根卷/当前归档备忘录/最近日记/代录约定，超预算按兜底顺序砍并如实注明）。可带 recentJson（[{sender,text,time,isSelf}] 字符串）生成退役窗口补偿块，带 message 顺出每轮检索块。返回的 text 原样可用。',
    parameters: {
      recentJson: { type: 'string', description: '可选：最近聊天记录 JSON 数组字符串，用于补偿块' },
      message: { type: 'string', description: '可选：顺带跑一次每轮检索（同 whale_recall）' },
    },
    async execute(args) {
      const argv = ['--json']
      if (args?.message) argv.push('--message', String(args.message))
      let recentFile = ''
      if (args?.recentJson) {
        recentFile = join(home, `recent-${Date.now()}.json`)
        try { writeFileSync(recentFile, String(args.recentJson), 'utf8'); argv.push('--recent', recentFile) } catch { recentFile = '' }
      }
      const r = await run('wake-snapshot.mjs', argv)
      const p = parseJson(r)
      if (recentFile) { try { unlinkSync(recentFile) } catch { /* 删不掉就算了 */ } }
      if (!p.ok) {
        return { ok: false, note: p.raw || p.stderr, exitCode: p.exitCode, hint: '大脑目录不存在或快照为空 —— 先跑 whale_status / whale_doctor；旧聊天想搬进来见仓库 docs/MIGRATION.md。' }
      }
      return { ok: true, ...p.data }
    },
  })

  // ④ 每轮召回：四层检索（强关键词/近义/n-gram/SimHash）
  tool({
    name: 'whale_recall',
    description: '给一条消息跑【每轮相关回忆】：零 token 本地四层召回（强关键词→近义联想→字面 n-gram→SimHash 指纹）。查不到是正常结果 —— 返回 hits=false 加空 text，绝不硬塞回忆。适合宿主 AI 每轮（或关键词轮）注入。',
    parameters: {
      message: { type: 'string', description: '要检索的消息原文（取尾部 600 字）' },
    },
    async execute(args) {
      const msg = String(args?.message ?? '').trim()
      if (!msg) return { ok: false, note: 'message 不能为空' }
      const r = await run('wake-snapshot.mjs', ['--no-snapshot', '--json', '--message', msg])
      if (r.code === 0) {
        const p = parseJson(r)
        if (p.ok) return { ok: true, hits: (p.data.retrievalChars || 0) > 0, ...p.data }
      }
      // 没命中时脚本走 exit 1 + 「什么都没生成」；先认 stderr 里的「没有命中」标记
      const miss = /没有命中/.test(r.err || '')
      if (miss) return { ok: true, hits: false, text: '', note: '本次四层检索没有命中 —— 正常结果，不注入。' }
      return { ok: false, exitCode: r.code, stderr: r.err, hint: '看 whale_status：大脑目录存在吗？' }
    },
  })

  // ⑤ 索引卷重建
  tool({
    name: 'whale_index',
    description: '重建【索引卷 / 候选新词清单】（build-memory-index.mjs）：扫全库生成词频与索引文档，供关键词表和每周质检用。幂等，随便跑。',
    parameters: {},
    async execute() {
      const r = await run('build-memory-index.mjs')
      return { ok: r.code === 0, exitCode: r.code, out: r.out.trim().split('\n').slice(-20).join('\n'), stderr: r.err.trim() || undefined }
    },
  })

  // ⑥ 打标 / 审计
  tool({
    name: 'whale_tags',
    description: '记忆打标三件套：mode=dry 只预览补哪些〔标签〕；mode=write 真写回（自动留 .bak + 码本生长）；mode=audit 出打标质检报告（--json 机器可读）。红线：只追加标签，绝不改写正文。',
    parameters: {
      mode: { type: 'string', description: 'dry（默认）| write | audit' },
    },
    async execute(args) {
      const mode = ['dry', 'write', 'audit'].includes(String(args?.mode)) ? String(args.mode) : 'dry'
      if (mode === 'audit') {
        const r = parseJson(await run('audit-memory-tags.mjs', ['--json']))
        return r.ok ? { ok: true, mode, data: r.data } : { ok: false, mode, raw: r.raw, exitCode: r.exitCode, stderr: r.stderr }
      }
      const r = await run('auto-tag-memory.mjs', mode === 'dry' ? ['--dry'] : [])
      return { ok: r.code === 0, mode, exitCode: r.code, out: r.out.trim().split('\n').slice(-30).join('\n'), stderr: r.err.trim() || undefined }
    },
  })

  ctx.effect(() => () => { /* 无长驻子进程：脚本都是即起即退 */ }, 'whale-memory: 收摊（无事可做）')
}
