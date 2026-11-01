/**
 * 模型元数据的回归钉子：档位表、上下文窗口覆盖、档位顺序。
 *
 *     node scripts/channel-model-metadata-test.mjs
 *
 * 判据一律取自**模型选择器实际读的那条路径**（`resolveModel`），不读 `pack.js`
 * 的源码文本 —— 文本断言在 esbuild 重排/压缩后会假红或假绿，而这里锁的三条
 * 全是**静默错配**：用户只会看到档位少了几个、或长会话莫名截断，没有任何
 * 报错指向声明的元数据。
 *
 * 三条各锁一件事：
 * 1. WorkBuddy 的 `deepseek-v4.1-flash` / `-sg` 声明五档（本表是**唯一**来源）；
 * 2. Loomy `spark-x` 的真实窗口 262144 —— **远端路径与兜底路径都测**，因为
 *    `resolveModel` 远端优先，只改兜底表完全无效（本 issue 最容易踩空的点）；
 * 3. 思考档位按强度序声明（弱 → 强），且**默认档不得随之翻转**。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-model-metadata-'))
const kernel = new URL('./lib/channel-pack-kernel.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/')) return { url: kernel, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
process.env.DSH_HOME = scratch
// ⚠️⚠️ **OfficeAce 的用户级目录必须进程级隔离**（2026-10-19 事故修复）。
//    `officeace-auth.ts` 的三条用户级路径（`~/.dsh-officeace` 凭据、兼容
//    `session.json`、`~/.office-claw` cookie）**只认 `DSH_OFFICEACE_HOME`**，
//    `DSH_HOME` 管不到它。不隔离的后果：`persistLogin()` 顺手写的那份兼容文件
//    落到**真实 home**，而 `apply()` 里有 fire-and-forget 的续期链、空池时回落到
//    读本机凭据 ⇒ 真实 DSH 每 30 分钟拿那份**桩 token** 去打华为云 STS，
//    日志刷 `STS5.1806 invalid refresh token: 'decode jwt header failed'`。
//    ⇒ 只能进程级（与 gitee 上游 `tests/setup-isolation.ts` 同款做法）。
process.env.DSH_OFFICEACE_HOME = path.join(scratch, 'officeace')

process.env.DSH_OPENAI_GATEWAY_ENABLED = '0'
process.env.QODER_MACHINE_TOKEN_PATH = path.join(scratch, 'machine-token.json')
process.env.QODER_RUNTIME_INFO = path.join(scratch, 'missing-runtime-info.exe')

// 一个已登录的 loomy 账号：让**远端目录路径**可达（否则只测到兜底表）。
const loomyCredential = JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh' })
const adapters = new Map()
const services = {
  profileContext: { home: scratch },
  credentials: {
    resolve: async (ref) => (ref === 'LOOMY_ACCOUNT_ONE' ? { value: loomyCredential } : undefined),
    describe: async () => undefined,
    set: async () => {},
    unset: async () => {},
  },
  llm: {
    registerAdapter(providers, adapter) { for (const provider of providers) adapters.set(provider, adapter) },
    listProviders: () => [...adapters.keys()].map(id => ({ id })),
  },
  connection: { fetch: { register() {} } },
}
const ctx = {
  ...services,
  logger: { info() {}, warn() {}, error() {} },
  get: name => services[name],
  provide(name, service) { services[name] = service; this[name] = service },
  effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanup() },
  inject(names, callback) { if (names.every(name => services[name] !== undefined)) callback(this) },
  emit() {},
}
fs.mkdirSync(path.join(scratch, 'channel-pack'))
fs.writeFileSync(path.join(scratch, 'channel-pack/state.json'), JSON.stringify({
  accounts: [{
    id: 'loomy-one', provider: 'loomy', nickname: 'Loomy fixture',
    credentialRef: 'LOOMY_ACCOUNT_ONE', enabled: true, refreshable: true, createdAt: 1,
  }],
  disabledModels: {},
}))

/** 远端目录：`spark-x` 声明 1048576（**虚高**，真实墙 262144）。 */
const savedFetch = globalThis.fetch
function withLoomyRemoteCatalog() {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (!url.includes('/models')) throw new Error(`unexpected fetch in this suite: ${url}`)
    return new Response(JSON.stringify({
      data: [
        {
          id: 'spark-x', name: 'Spark X2.5 · x0.1', type: 'chat', context_length: 1_048_576,
          capabilities: { reasoning: true }, input_modalities: ['text'],
          reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
        },
        {
          id: 'qwen-3.8-max', name: 'Qwen 3.8 Max · x12.0', type: 'chat', context_length: 1_000_000,
          capabilities: { reasoning: true }, input_modalities: ['text'],
          reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return () => { globalThis.fetch = savedFetch }
}

const ids = (resolved) => resolved.reasoning?.efforts?.map((effort) => String(effort.id)) ?? []

globalThis.fetch = async () => { throw new Error('external network is disabled in this suite') }
const { apply } = await import('../vendor/channel-pack/pack.js')
apply(ctx, { disableOpencode: true })
await new Promise(resolve => setImmediate(resolve))

// ── 1. WorkBuddy 的 deepseek-v4.1-flash 系列：五档 ────────────────────────────
//
// 这两个模型的档位**唯一来源就是本表**：国际版 `/v3/config` 对它们不下发
// `supportedEfforts`（只给单值 `reasoning.effort`），而宿主解析只认数组，
// 故远端那个表态被静默忽略 —— 表里写少了就是「用户永远选不到那些档」。
const FIVE = ['low', 'medium', 'high', 'xhigh', 'max']
const workbuddy = adapters.get('workbuddy')
assert.ok(workbuddy, 'workbuddy adapter must be registered')
for (const model of ['deepseek-v4.1-flash', 'deepseek-v4.1-flash-sg']) {
  const resolved = await workbuddy.resolveModel('workbuddy', model)
  assert.deepEqual(ids(resolved), FIVE,
    `${model} 必须声明五档（low/medium/high/xhigh/max），实得 ${JSON.stringify(ids(resolved))}`)
  assert.equal(String(resolved.reasoning.defaultEffort), 'high', `${model} 默认档仍须为 high`)
}
console.log('ok  workbuddy deepseek-v4.1-flash / -sg 声明五档，默认 high')

// ── 2. Loomy spark-x：兜底路径 + **远端路径** ─────────────────────────────────
const loomy = adapters.get('loomy')
assert.ok(loomy, 'loomy adapter must be registered')

const fallbackSpark = await loomy.resolveModel('loomy', 'spark-x')
assert.equal(fallbackSpark.context?.contextWindow, 262_144,
  `兜底路径下 spark-x 的窗口必须是 262144，实得 ${fallbackSpark.context?.contextWindow}`)
console.log('ok  loomy spark-x 兜底路径 = 262144')

// ⚠️ 远端路径必须单独测：`resolveModel` 是远端优先，只改兜底表**完全无效**。
// 这一格若缺失，本 issue 会以「兜底表断言全绿、真实场景照样截断」的形式复发。
const restoreFetch = withLoomyRemoteCatalog()
try {
  const remoteSpark = await loomy.resolveModel('loomy', 'spark-x')
  assert.equal(remoteSpark.context?.contextWindow, 262_144,
    `远端声明 1048576 时 spark-x 仍须被覆盖成 262144，实得 ${remoteSpark.context?.contextWindow}`)
  const untouched = await loomy.resolveModel('loomy', 'qwen-3.8-max')
  assert.equal(untouched.context?.contextWindow, 1_000_000, '覆盖表不得误伤其余模型')
} finally {
  restoreFetch()
}
console.log('ok  loomy spark-x **远端路径**（远端虚报 1048576）仍解析为 262144，其余不误伤')

// ── 3. 思考档位的声明顺序 = 强度序（弱 → 强） ─────────────────────────────────
//
// DSH 把该数组当**展示顺序**、不重排（`adapter-preferred display order`），
// 客户端直接 map ⇒ 把默认档排首位会让「开启」落在横向档位轴的最左（左强右弱）。
// `REASONING_EFFORT_RANK` 要求 off 在前。
// ⚠️ 顺序调整**不得**改变默认档 —— 那才是真正危险的部分（方向取反）。
const codearts = adapters.get('codearts')
assert.ok(codearts, 'codearts adapter must be registered')
const codeartsResolved = await codearts.resolveModel('codearts', 'deepseek-v4.1-flash')
assert.deepEqual(ids(codeartsResolved), ['off', 'on'],
  `codearts 档位须为强度序 [off,on]，实得 ${JSON.stringify(ids(codeartsResolved))}`)
assert.equal(String(codeartsResolved.reasoning.defaultEffort), 'on', 'codearts 默认档仍须为 on')
console.log('ok  codearts 档位顺序 = [off, on]，默认档仍为 on')

const raccoon = adapters.get('raccoon')
assert.ok(raccoon, 'raccoon adapter must be registered')
const raccoonResolved = await raccoon.resolveModel('raccoon', 'sn-glm-5-3')
assert.deepEqual(ids(raccoonResolved), ['off', 'on'],
  `raccoon 档位须为强度序 [off,on]，实得 ${JSON.stringify(ids(raccoonResolved))}`)
// ⚠️ 方向取反的哨兵：旧实现拿「数组首项」当默认档，顺序一改就静默变成「关闭思考」。
assert.equal(String(raccoonResolved.reasoning.defaultEffort), 'on',
  'raccoon 默认档必须仍是 on（顺序调整不得让它翻成 off）')
console.log('ok  raccoon 档位顺序 = [off, on] 且默认档仍为 on')

// ── 目录解析：带版本后缀的模型不得被静默吞掉（上游 7167acb0 第 3 项 / IKQY27）──
{
  // 上游把「旧版」与「带日期的新版」当成**两个独立条目**同时下发。修前用
  // `normalizeModelId(rawId)` 做 id **与去重键** ⇒ `X-1017` 被改写成 `X`、
  // 撞 seen 后静默丢弃 ⇒ 用户看到「IDE 已更新，插件列表没更新」且零提示。
  // ⚠️ 两段式：① 源码级断言钉住「id 与去重键都用原始 rawId」（抓「改回归一化」）；
  // ② 用**等价内联实现**跑行为真值表（抓「语义不对」）。
  // 不从 `models.ts` 直接 import：它是 TS，本套件没带 --experimental-strip-types。
  const modelsSrc = fs.readFileSync(
    new URL('../vendor/channel-pack/src/models.ts', import.meta.url), 'utf8')
  assert.match(modelsSrc, /const id = rawId/,
    'parseModelInfo 的 id 必须是**原始 rawId**（不能是 normalizeModelId(rawId)）')
  assert.match(modelsSrc, /if \(seen\.has\(id\)\) return undefined\n  seen\.add\(id\)/,
    'seen 的键也必须是原始 id（用归一后的会把两条并成一条）')
  assert.doesNotMatch(modelsSrc, /const id = normalizeModelId\(rawId\)/,
    '不得退回「id = 归一化结果」（那会静默吞掉带版本号的条目）')
  // 等价实现（与源码同语义）：id/去重键都用原始值
  const parseModelInfoForTest = (m, seen) => {
    const rawId = m['model_id']
    if (typeof rawId !== 'string' || rawId.length === 0) return undefined
    const id = rawId
    if (id.includes('-VL-') || id.endsWith('-VL')) return undefined
    const rawName = m['model_name']
    const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : id
    if (seen.has(id)) return undefined
    seen.add(id)
    return { id, name }
  }
  const seen = new Set()
  const entries = [
    { model_id: 'deepseek-v4.1-flash', model_name: 'DeepSeek-V4.1-Flash' },
    { model_id: 'deepseek-v4.1-flash-1017', model_name: 'DeepSeek-V4.1-Flash-1017' },
  ]
  const parsed = entries.map((e) => parseModelInfoForTest(e, seen)).filter(Boolean)
  assert.equal(parsed.length, 2,
    `并存的两条都必须保留（带版本号那条曾被静默丢弃），实得 ${parsed.length} 条: `
    + JSON.stringify(parsed.map((p) => p.id)))
  assert.ok(parsed.some((p) => p.id === 'deepseek-v4.1-flash-1017'),
    '带版本号的 id 必须原样保留（它是独立模型）')
  assert.ok(parsed.some((p) => p.name.includes('1017')),
    '展示名也必须保留版本号（否则与旧版同名、无法区分）')
  console.log('ok  目录解析：并存旧版与 -1017 时两条都保留（不静默吞掉）')
}

console.log('\nchannel-model-metadata: 7/7 项通过')
