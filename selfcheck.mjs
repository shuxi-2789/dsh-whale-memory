/**
 * selfcheck.mjs —— dsh-whale-memory 的预检：**装进宿主前就把整条链路真跑一遍**
 *
 * 为什么（口径同 dsh-bili-scroll 的两连栽）：
 *   ① apply() 抛错 ⇒ 宿主里只有 `warning: 1 entry did not activate`，要重启才发现；
 *   ② parameters 里 object 没写 additionalProperties ⇒ defineTool 抛 JsonSchemaError ⇒ 整条不激活；
 *   ③ 本插件特有：工具是"包住脚本"的，脚本没铺到家 / env 覆盖没生效 ⇒ 第一次调用才炸。
 * 所以这里不只 import + apply，还要**把 6 个工具各真调一次**（对着临时沙箱里的一份大脑）。
 *
 * 用法：`node selfcheck.mjs`（在插件目录里跑）
 * 退出码：0 = 全绿；1 = 有问题（把原因打在 ✗ 那行）
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SB = join(tmpdir(), 'dsh-whale-memory-selfcheck')
const fail = (msg, e) => {
  console.error(`\n✗ ${msg}`)
  if (e) console.error(`  ${e?.name}: ${e?.message}`)
  const frame = String(e?.stack ?? '').split('\n').slice(1, 4).join('\n')
  if (frame) console.error(frame)
  process.exit(1)
}

/* ── 沙箱家：先清再建，把模板摆成一副"能跑的大脑" ── */
try { rmSync(SB, { recursive: true, force: true }) } catch { /* 清不掉就留着 */ }
mkdirSync(SB, { recursive: true })
cpSync(join('vendor', 'brain-template'), join(SB, 'brain-template'), { recursive: true })
cpSync(join('vendor', 'diary-template'), join(SB, 'diary-template'), { recursive: true })

/* ── ① host 半端：假 ctx 上真跑 apply() ── */

let mod
try {
  mod = await import('./index.js')
} catch (e) {
  fail('连 import index.js 都失败（依赖没解析？）', e)
}

const registered = []
const fakeCtx = {
  // ⭐ 宿主给的是**函数**（dshHomePath(...segments)），照样给函数 —— 别用字符串
  get: (k) => (k === 'dshHomePath' ? (...seg) => join(SB, 'home', ...seg) : undefined),
  logger: { info: () => {}, warn: () => {} },
  tools: { register: (t) => { registered.push(t); return t } },
  effect: (fn) => { try { return fn() } catch { return undefined } },
}

const config = {
  enabled: true,
  persona: '小鲸鱼',
  brainDir: join(SB, 'brain-template'),
  diaryDir: join(SB, 'diary-template'),
  archivePrefix: '',
  diaryFileName: '',
}

try {
  mod.apply(fakeCtx, config)
} catch (e) {
  fail('host 半端 apply() 抛错 —— 宿主里就是那句 `entry did not activate`', e)
}

const names = registered.map((t) => t?.name ?? String(t))
const EXPECT = ['whale_status', 'whale_doctor', 'whale_wake', 'whale_recall', 'whale_index', 'whale_tags']
console.log(`✓ host 半端 OK：name=${mod.name}  inject=${JSON.stringify(mod.inject)}  工具 ${registered.length} 个`)
for (const n of EXPECT) {
  if (!names.includes(n)) fail(`少注册了工具 ${n}（实际：${names.join(', ')}）`)
}
if (names.length !== EXPECT.length) fail(`工具数量不对：期望 ${EXPECT.length}，实际 ${names.length}（${names.join(', ')}）`)
if (mod.Config === undefined) console.log('⚠ schemastery 没拿到（Config=undefined）—— 设置页降级，插件本体不受影响；装进 profile 后应能拿到')

/* ── ② 家目录铺设验证 ── */
const homeBrain = join(SB, 'home', 'whale-memory', 'brain')
for (const f of ['scripts/doctor.mjs', 'src/soul-inherit-lib.mjs', 'config.json', '.synced-version',
  'tests/test-soul-inherit.mjs', 'fixtures/小雪的总回忆/记忆回溯模块.md']) {
  if (!existsSync(join(homeBrain, f))) fail(`家目录没铺出 ${f}（ensureHome 没跑对？）`)
}
console.log(`✓ 家目录铺设 OK（${homeBrain}）`)

/* ── ③ 6 个工具各真调一次（脚本子进程全走沙箱大脑）── */
const byName = Object.fromEntries(registered.map((t) => [t?.name, t]))
const call = async (name, args = {}) => {
  const t = byName[name]
  const fn = t?.execute
  if (typeof fn !== 'function') fail(`${name} 注册的对象上没有可调的 execute()`)
  const r = await fn(args, {})
  return typeof r === 'string' ? JSON.parse(r) : r
}

let r = await call('whale_status')
if (!r?.ok) fail(`whale_status 不 ok：${JSON.stringify(r).slice(0, 300)}`)
console.log(`✓ whale_status OK（persona=${r.persona} 大脑在位=${r.skeleton?.brainExists}）`)

r = await call('whale_doctor')
if (!r?.ok) fail(`whale_doctor 不 ok：${JSON.stringify(r).slice(0, 500)}`)
console.log('✓ whale_doctor OK（doctor.mjs --json 解析成功）')

r = await call('whale_wake')
if (!r?.ok || !r?.text || r.text.length < 200) fail(`whale_wake 快照太短或失败：${JSON.stringify(r).slice(0, 300)}`)
console.log(`✓ whale_wake OK（快照 ${r.snapshotChars} 字）`)

r = await call('whale_recall', { message: '今天有人夸我了' })
if (r?.ok !== true) fail(`whale_recall 不 ok：${JSON.stringify(r).slice(0, 300)}`)
console.log(`✓ whale_recall OK（hits=${r.hits} —— 没命中也是正常绿）`)

r = await call('whale_index')
if (!r?.ok) fail(`whale_index 不 ok：${JSON.stringify(r).slice(0, 300)}`)
console.log('✓ whale_index OK')

r = await call('whale_tags', { mode: 'dry' })
if (!r?.ok) fail(`whale_tags(dry) 不 ok：${JSON.stringify(r).slice(0, 300)}`)
console.log('✓ whale_tags OK（dry 模式）')

/* ── ④ 回归文件在位（不默认跑全套，211+212 昨晚已全绿；要跑传 env WHALE_FULL=1）── */
if (process.env.WHALE_FULL === '1') {
  const { spawnSync } = await import('node:child_process')
  const env = { ...process.env, BRAIN_DIR: join(SB, 'brain-template'), DIARY_DIR: join(SB, 'diary-template'), PERSONA: '小鲸鱼' }
  for (const t of ['test-soul-inherit.mjs', 'test-memory-scan.mjs', 'test-diary-lib.mjs']) {
    const s = spawnSync(process.execPath, [join(homeBrain, 'tests', t)], { cwd: homeBrain, env, encoding: 'utf8', timeout: 300000 })
    const out = `${s.stdout || ''}\n${s.stderr || ''}`
    if (s.status !== 0) fail(`回归 ${t} 没过：${out.split('\n').slice(-8).join('\n')}`)
    console.log(`✓ 回归 ${t}：${out.trim().split('\n').slice(-2)[0] || '0 failed'}`)
  }
  /* 🔴 0.1.2 补：走**工具路径**跑 withTests（0.1.1 验收实锤 bug——runTest 误去 scripts/ 找回归脚本，
     上面直 spawn 那条不经过工具的目录解析，测不出来）*/
  const wt = await call('whale_doctor', { withTests: true })
  if (!wt?.testsAllGreen) fail(`whale_doctor {withTests} 工具路径没过：${JSON.stringify(wt?.tests).slice(0, 400)}`)
  console.log('✓ whale_doctor {withTests} 工具路径 OK（tests/ 解析正确，三条回归经工具全绿）')
} else {
  console.log('（回归全套没跑 —— 传 WHALE_FULL=1 打开；昨晚 211/212 已全绿）')
}

/* ── ⑤ 脏宿主回归（0.1.0 桌面版实测翻车点）：config 字段不是裸字符串时，
      铺到家的 config.json 必须是干净默认值，绝不写 "[object Object]" ── */
try { rmSync(join(SB, 'home'), { recursive: true, force: true }) } catch { /* 重来 */ }
const dirtyCtx = {
  get: (k) => (k === 'dshHomePath' ? (...seg) => join(SB, 'home', ...seg) : undefined),
  logger: { info: () => {}, warn: () => {} },
  tools: { register: () => ({}) },
  effect: (fn) => { try { return fn() } catch { return undefined } },
}
mod.apply(dirtyCtx, { persona: { schema: true }, brainDir: {}, diaryDir: undefined, enabled: true })
const dirtyCfg = JSON.parse(readFileSync(join(SB, 'home', 'whale-memory', 'brain', 'config.json'), 'utf8'))
const si = dirtyCfg.socialV2.soulInherit
if (/\[object Object\]/.test(JSON.stringify(si))) fail(`脏 config 没被消毒，家 config.json 里还有 [object Object]：${JSON.stringify(si).slice(0, 200)}`)
if (si.persona !== '小鲸鱼') fail(`脏 config 消毒后 persona 应回退默认「小鲸鱼」，实际 ${JSON.stringify(si.persona)}`)
if (!si.brainDir || !si.diaryDir) fail('脏 config 消毒后 brainDir/diaryDir 应回退桌面默认路径')
if (si.archivePrefix !== '') fail(`archivePrefix 留空应写 ""（= 任意结尾是编号的目录都认，0.1.2 规格），实际 ${JSON.stringify(si.archivePrefix)}`)
console.log('✓ 脏宿主消毒 OK（[object Object] 进、干净默认值出，archivePrefix 落 ""）')

try { rmSync(SB, { recursive: true, force: true }) } catch { /* 留着也无所谓 */ }
console.log(`\n★ selfcheck 全绿。（沙箱在 ${SB}，已清理）`)
