/**
 * Accio **请求级账号轮换**的回归钉子（上游 IKM3ZV，本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-accio-rotate-test.mjs
 *
 * ## 钉住什么（真实缺陷）
 *
 * 改前整条请求路径**零换号**：`resolveCredential` 取回一个账号 → 不成即抛错。
 * ⇒ 账号池登录 N 个账号后，第一个额度耗尽时**第二个从未被尝试**
 * ——「登录 N 个账号并未带来 N 倍可用性」。
 *
 * ## 四类失败的处置（**写不写冷却**与换不换号是两件事）
 *
 * | 类别 | 判据 | 换号 | 写冷却 |
 * |---|---|---|---|
 * | `quota` | HTTP 402 / 流内 `error_code:402` | ✅ | ✅ 至 UTC+8 当日 24:00 |
 * | `rate` | HTTP 429 | ✅ | ✅ 1 小时 |
 * | `auth` | HTTP 401/403 | ✅ | ❌ **绝不写**（2026-06-10「全池被封」事故换来的不变式） |
 * | `other` | 400 参数错 / 5xx / 风控页 | ❌ | ❌ |
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js`（真实挂载）＋ 桩 fetch（按账号脚本化响应）。
 * - 输出：6 条断言；全过打印 `channel-accio-rotate: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-accio-rot-'))
const kernel = new URL('./lib/channel-pack-kernel.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/')) return { url: kernel, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
process.env.DSH_HOME = scratch
process.env.DSH_OFFICEACE_HOME = path.join(scratch, 'officeace')
process.env.DSH_OPENAI_GATEWAY_ENABLED = '0'
process.env.NODE_ENV = 'test'

const disposers = []
const stateDir = path.join(scratch, 'channel-pack')
fs.mkdirSync(stateDir, { recursive: true })
const readState = () => JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'))
const noCooldown = (id) => {
  const a = readState().accounts.find((x) => x.id === id)
  return a === undefined || a.modelRateLimits === undefined || Object.keys(a.modelRateLimits).length === 0
}

async function mount(accounts) {
  const creds = new Map()
  const adapters = new Map()
  for (const a of accounts) {
    creds.set(a.credentialRef, { value: JSON.stringify({
      access_token: `tok-${a.id}`, refresh_token: `rt-${a.id}`,
    }) })
  }
  const services = {
    profileContext: { home: scratch },
    credentials: {
      resolve: async (ref) => creds.get(ref),
      describe: async () => undefined,
      set: async (ref, value) => creds.set(ref, { value }),
      unset: async (ref) => creds.delete(ref),
    },
    llm: {
      registerAdapter(providers, adapter) { for (const p of providers) adapters.set(p, adapter) },
      listProviders: () => [...adapters.keys()].map((id) => ({ id })),
    },
    connection: { fetch: { register: () => {} } },
  }
  const ctx = {
    ...services,
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => services[name],
    provide(name, service) { services[name] = service; this[name] = service },
    // ⚠️⚠️ **绝不能立即执行 cleanup**（本套件第一版就栽在这）：
    // `apply()` 里用 `ctx.effect(() => () => network.close())` 注册出网钩子的
    // 释放函数；若这里立刻调 cleanup，`network` 就被 close 了 ⇒ 之后每个请求都报
    // 「渠道出网服务已停止」，表现为「请求根本没发出」。
    // ⇒ 收集起来，在用例结束时才执行。
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') disposers.push(cleanup)
    },
    inject(names, callback) { if (names.every((n) => services[n] !== undefined)) callback(this) },
    emit() {},
  }
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({
    accounts, disabledModels: {}, gatewayEnabled: false,
  }))
  const { apply } = await import('../vendor/channel-pack/pack.js')
  apply(ctx, { disableOpencode: true })
  await new Promise((resolve) => setImmediate(resolve))
  return adapters.get('accio')
}

const MODEL = 'glm-5-3-flash'
const acct = (id) => ({
  id, provider: 'accio', nickname: id, enabled: true, refreshable: true,
  createdAt: 1, credentialRef: `ACCIO_ACCOUNT_${id.toUpperCase()}`,
})
/** 正常 SSE：一帧正文 + 完成。 */
const okStream = () => new Response(
  'data: {"candidates":[{"content":{"parts":[{"text":"收到"}],"role":"model"}}]}\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
)
const err = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

async function drain(adapter) {
  const out = []
  for await (const c of adapter.stream({
    provider: 'accio', model: MODEL,
    messages: [{ role: 'user', content: 'hi' }],
  })) out.push(c)
  return out
}

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 判据函数：quota/rate/auth 换号，other 不换；且 auth 不写冷却', async () => {
  const mod = await import('../vendor/channel-pack/src/accio-adapter.ts')
    .catch(() => null)
  if (mod === null) {
    // 源码是 TS 且本套件没带 strip-types ⇒ 退回源码级断言
    const src = fs.readFileSync(
      new URL('../vendor/channel-pack/src/accio-adapter.ts', import.meta.url), 'utf8')
    assert.match(src, /export function accioFailureClassOf/, '应有分类函数')
    assert.match(src, /code === 'QUOTA_EXCEEDED'\) return 'quota'/s, 'quota 判据')
    assert.match(src, /code === 'AUTH'\) return 'auth'/s, 'auth 判据')
    const recSeg = src.slice(src.indexOf('export function recordsAccioRateLimit'))
    assert.match(recSeg.slice(0, 240), /cls === 'quota' \|\| cls === 'rate'/,
      '写冷却只对 quota/rate（auth 绝不写）')
    // ⚠️⚠️ **必须断言 auth 不在返回表达式里** —— 只断言「含 quota||rate」的话，
    // 把 `|| cls === 'auth'` 加上去仍然绿（2026-11-02 变异实测抓到的假绿）。
    assert.doesNotMatch(recSeg.slice(0, 240), /cls === 'auth'/,
      'recordsAccioRateLimit **不得**包含 auth（认证类写冷却会把「换号就能好」的路径堵死）')
    return
  }
  assert.equal(mod.shouldRotateAccioAccount('QUOTA_EXCEEDED'), true)
  assert.equal(mod.shouldRotateAccioAccount('RATE_LIMIT'), true)
  assert.equal(mod.shouldRotateAccioAccount('AUTH'), true)
  assert.equal(mod.shouldRotateAccioAccount('INVALID_REQUEST'), false, 'other 不换号')
  assert.equal(mod.recordsAccioRateLimit('AUTH'), false, 'auth 绝不写冷却')
})

await step('② HTTP 402 → 换到第二个账号并成功（不再「整轮失败」）', async () => {
  const saved = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    const u = String(url)
    // ⚠️ **只对推理端点脚本化**：续期 / 探测也会打 fetch，计入 `calls` 会让
    // 「实发几次」的断言失真（本套件第一版就这么红过）。
    if (!u.includes('/api/adk/llm/generateContent')) return Response.json({})
    calls++
    if (calls === 1) return err(402, { error_code: '402', error_message: 'unauthorized' })
    return okStream()
  }
  try {
    const adapter = await mount([acct('a1'), acct('a2')])
    const chunks = await drain(adapter)
    assert.ok(JSON.stringify(chunks).includes('收到'),
      `换号后应拿到第二个账号的响应（说明 N 个账号真的带来 N 倍可用性）`)
    assert.equal(calls, 2, `应发 2 次请求（实发 ${calls}）`)
    // 额度耗尽必须写冷却（至 UTC+8 当日 24:00）
    assert.ok(!noCooldown('a1'), '被 402 拒的账号必须写冷却（额度耗尽）')
  } finally { globalThis.fetch = saved }
})

await step('③ HTTP 429 → 换号 + 写冷却（1 小时档）', async () => {
  const saved = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/adk/llm/generateContent')) return Response.json({})
    calls++
    if (calls === 1) return err(429, { error_code: '429', error_message: 'rate limited' })
    return okStream()
  }
  try {
    const adapter = await mount([acct('b1'), acct('b2')])
    const chunks = await drain(adapter)
    assert.ok(JSON.stringify(chunks).includes('收到'), '429 后应换号成功')
    assert.ok(!noCooldown('b1'), '429 必须写冷却')
  } finally { globalThis.fetch = saved }
})

await step('④ HTTP 401 → 换号但**绝不写冷却**（全池被封不变式）', async () => {
  const saved = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    const u = String(url)
    // ⚠️ 401 会先走「刷新凭据再重试」的既有路径 ⇒ 续期端点要**给成功响应**，
    // 否则 `refresh()` 抛错、换号永远走不到（本套件第一版就红在这）。
    if (u.includes('/api/auth/refresh_token')) {
      // ⚠️ 响应必须形如 `{success:true, data:{…}}`（`unwrapTokenEnvelope` 的契约），
      // 直接平铺字段会报「失败」——本套件第二版红在这。
      return Response.json({
        success: true,
        data: {
          accessToken: 'tok-refreshed', refreshToken: 'rt-refreshed',
          expiresAt: Date.now() + 3_600_000,
        },
      })
    }
    if (!u.includes('/api/adk/llm/generateContent')) return Response.json({})
    calls++
    if (calls === 1) return err(401, { error_code: '401', error_message: 'unauthorized' })
    return okStream()
  }
  try {
    const adapter = await mount([acct('c1'), acct('c2')])
    const chunks = await drain(adapter)
    assert.ok(JSON.stringify(chunks).includes('收到'), '401 后应换号成功')
    assert.ok(noCooldown('c1'),
      '认证类**绝不写冷却**（写了会把「换号就能好」的路径堵死）')
  } finally { globalThis.fetch = saved }
})

await step('⑤ HTTP 400（请求本身有问题）→ **不换号**，原样抛', async () => {
  const saved = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/adk/llm/generateContent')) return Response.json({})
    calls++
    return err(400, { error_code: '400', error_message: 'bad request' })
  }
  try {
    const adapter = await mount([acct('d1'), acct('d2')])
    let caught
    try { await drain(adapter) } catch (error) { caught = error }
    assert.ok(caught, '400 应抛错')
    assert.equal(calls, 1, `400 不得换号（换号只会白烧整池），实发 ${calls} 次`)
    assert.ok(noCooldown('d1'), '400 不写冷却')
  } finally { globalThis.fetch = saved }
})

await step('⑥ 全部账号额度耗尽 → 报 QUOTA_EXCEEDED（不伪装成内部错误）', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('/api/adk/llm/generateContent')
    ? err(402, { error_code: '402', error_message: 'unauthorized' })
    : Response.json({})
  try {
    const adapter = await mount([acct('e1'), acct('e2')])
    let caught
    try { await drain(adapter) } catch (error) { caught = error }
    assert.ok(caught, '全池耗尽应抛错')
    assert.equal(caught.code, 'QUOTA_EXCEEDED',
      `必须保留额度语义（不得伪装成 SERVER/内部错误），实为 ${caught.code}`)
  } finally { globalThis.fetch = saved }
})

if (failed > 0) { console.error(`\nchannel-accio-rotate: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-accio-rotate: 全部通过')
