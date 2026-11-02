/**
 * WorkBuddy / CodeBuddy 的 `X-Conversation-*` 三头 + 渠道校验（11128）回归钉子。
 *
 *     node scripts/channel-buddy-conv-test.mjs
 *
 * ## 钉住什么（2026-10-21 从 gitee 上游移植，真机探针复现）
 *
 * 1. **根因**：`send()` 必须发三枚非空 `X-Conversation-*` 头 —— 特定账号缺任一枚，
 *    上游每轮回 `HTTP 400 {"code":11128,"msg":"request illegal"}` ⇒ 整条渠道全灭。
 *    （真机实测：同一账号同一请求体，无三头 400 → 带三头 200 + 真实 SSE。）
 * 2. **纵深**：万一仍被渠道校验拒（多账号池里个别账号 / 上游收紧），必须
 *    ① 进入**换号**（不是「非限流即抛」），② **不写冷却**（该账号并非坏账号），
 *    ③ 报 `PERMISSION_DENIED` 且文案指向**账号**（绝不「重发/改内容」）。
 * 3. **单账号池**（本机形态）：11128 必须报渠道校验档，**不能**误报成
 *    `QUOTA_EXCEEDED`「所有账号均受限」—— 上游 7b24e23 的 P0：
 *    `sawChannelVerification` 初值必须取首发判定结果。
 * 4. **不回归 11140**：安全策略拦截（403/11140）仍要**写冷却**并换号。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js`（真实挂载）＋ 桩 fetch（记录请求头、按脚本回响应）。
 * - 输出：4 条断言全过则 `channel-buddy-conv: 全部通过`，否则退出非零。
 * - 边界：不碰真实网络 / 真实凭据；冷却判据读 `state.json` 的 `modelRateLimits`。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-wb-conv-'))
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

const stateDir = path.join(scratch, 'channel-pack')
fs.mkdirSync(stateDir, { recursive: true })

/** 一次挂载：accounts 进 state.json，creds 进内存库。返回 workbuddy 适配器。 */
async function mount(accounts) {
  const creds = new Map()
  const adapters = new Map()
  const services = {
    profileContext: { home: scratch },
    credentials: {
      resolve: async (ref) => creds.get(ref),
      describe: async () => undefined,
      set: async (ref, value) => { creds.set(ref, { value }) },
      unset: async (ref) => { creds.delete(ref) },
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
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanup() },
    inject(names, callback) { if (names.every((n) => services[n] !== undefined)) callback(this) },
    emit() {},
  }
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({
    accounts, disabledModels: {}, gatewayEnabled: false,
  }))
  const { apply } = await import('../vendor/channel-pack/pack.js')
  apply(ctx, { disableOpencode: true })
  await new Promise((resolve) => setImmediate(resolve))
  // 每个账号一份有效凭据（access_token 非空即可过校验）。
  // ⚠️ 存 `{ value }` 对象 —— `credentials.resolve` 的契约是返回 `{value:string}`，
  //    存裸串会让 `resolved.value` 为 undefined ⇒ 适配器永远读不到凭据。
  for (const a of accounts) {
    creds.set(a.credentialRef, { value: JSON.stringify({
      access_token: `tok-${a.id}`, refresh_token: `rt-${a.id}`, expires_at: '2999-01-01T00:00:00Z',
    }) })
  }
  return { adapter: adapters.get('workbuddy'), creds }
}

const MODEL = 'deepseek-v4.1-flash'
const conv = (id) => ({
  id, provider: 'workbuddy', nickname: id, enabled: true, refreshable: true,
  createdAt: 1, credentialRef: `WORKBUDDY_ACCOUNT_${id.toUpperCase()}`,
})
const sseOk = () => new Response(
  'data: {"choices":[{"index":0,"delta":{"content":"收到"}}]}\n\ndata: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
)
const body400 = (code, msg) => new Response(JSON.stringify({ code, msg, requestId: 'req-x' }), { status: 400 })
const body403 = (code, msg) => new Response(JSON.stringify({ code, msg, requestId: 'req-x' }), { status: 403 })

async function drain(adapter) {
  const out = []
  for await (const c of adapter.stream({
    provider: 'workbuddy', model: MODEL,
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
  })) out.push(c)
  return out
}

const readState = () => JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'))
const noCooldown = (id) => {
  const acct = readState().accounts.find((x) => x.id === id)
  return acct === undefined || acct.modelRateLimits === undefined || Object.keys(acct.modelRateLimits).length === 0
}

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

// ① 根因：send() 发三枚非空 X-Conversation-* 头。
await step('① send() 带三枚非空 X-Conversation-* 头', async () => {
  let seenHeaders = null
  const saved = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/v2/chat/completions')) seenHeaders = init?.headers
    return sseOk()
  }
  try {
    const { adapter } = await mount([conv('wb1')])
    await drain(adapter)
    assert.ok(seenHeaders, '未发出聊天请求')
    const get = (k) => {
      if (typeof seenHeaders.get === 'function') return seenHeaders.get(k)
      for (const [key, v] of Object.entries(seenHeaders)) if (key.toLowerCase() === k.toLowerCase()) return v
      return undefined
    }
    for (const h of ['X-Conversation-ID', 'X-Conversation-Request-ID', 'X-Conversation-Message-ID']) {
      const v = get(h)
      assert.ok(typeof v === 'string' && v.length > 0, `缺非空 ${h}（根因修复失效）`)
    }
  } finally { globalThis.fetch = saved }
})

// ② 单账号池 11128：报渠道校验档（PERMISSION_DENIED），不误报额度受限，不写冷却。
await step('② 单账号 11128 → PERMISSION_DENIED 指向账号、不写冷却', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = async () => body400(11128, 'request illegal')
  try {
    const { adapter } = await mount([conv('wb2')])
    let err
    try { await drain(adapter) } catch (error) { err = error }
    assert.ok(err, '11128 应抛错')
    assert.equal(err.code, 'PERMISSION_DENIED', `错误码应为 PERMISSION_DENIED，实为 ${err.code}`)
    assert.match(err.message, /渠道校验/, '文案应含「渠道校验」')
    assert.match(err.message, /停用|顺序|provider/, '文案应指向账号处置，而非重发/改内容')
    assert.doesNotMatch(err.message, /所有账号均受限/, '不得误报成额度受限')
    assert.ok(noCooldown('wb2'), '渠道校验不得写账号冷却（该账号并非坏账号）')
  } finally { globalThis.fetch = saved }
})

// ③ 多账号池 11128：换号成功，坏账号不写冷却。
await step('③ 11128 换号到可用账号', async () => {
  const saved = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v2/chat/completions')) { calls++; if (calls === 1) return body400(11128, 'request illegal') }
    return sseOk()
  }
  try {
    const { adapter } = await mount([conv('wb3'), conv('wb4')])
    const chunks = await drain(adapter)
    assert.ok(JSON.stringify(chunks).includes('收到'), '换号后应拿到可用账号的响应')
    assert.ok(noCooldown('wb3'), '被渠道校验拒的账号不得写冷却')
  } finally { globalThis.fetch = saved }
})

// ④ 不回归 11140：403/11140 仍写冷却。
await step('④ 11140 仍写冷却（未被渠道校验排除逻辑误伤）', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = async () => body403(11140, 'request illegal')
  try {
    const { adapter } = await mount([conv('wb5')])
    let err
    try { await drain(adapter) } catch (error) { err = error }
    assert.ok(err, '11140 应抛错')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.ok(!noCooldown('wb5'), '11140 必须写冷却（与渠道校验相反）')
  } finally { globalThis.fetch = saved }
})

// ⑤ 11140 回 HTTP 400（后端行为变更）也必须换号 + 写冷却（上游 89f53be2）
await step('⑤ 11140 回 400 时也换号并写冷却', async () => {
  // 上游实测：11140 原固定回 403，后端改成**回 400**。旧实现只在 401/403 分支里
  // 处理 11140 ⇒ 400 直接抛 INVALID_REQUEST ⇒ 池里有可用账号也用不上。
  const saved = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v2/chat/completions')) {
      calls++
      // 首个账号 ← 400/11140；第二个账号 ← 正常
      if (calls === 1) return body400(11140, 'request illegal')
    }
    return sseOk()
  }
  try {
    const { adapter } = await mount([conv('wb6'), conv('wb7')])
    const chunks = await drain(adapter)
    assert.ok(JSON.stringify(chunks).includes('收到'), '换到可用账号后应拿到响应')
    // 被 11140 拦的账号**必须写冷却**（与 11128 渠道校验相反）
    assert.ok(!noCooldown('wb6'), '11140 必须写冷却（该账号需在冷却期内被跳过）')
    assert.equal(calls, 2, `应换号一次（实发 ${calls} 次）`)
  } finally { globalThis.fetch = saved }
})

// ⑥ 单账号池 400/11140：报 PERMISSION_DENIED，不得误报「所有账号均受限」
await step('⑥ 单账号 400/11140 → PERMISSION_DENIED（不误报额度受限）', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = async () => body400(11140, 'request illegal')
  try {
    const { adapter } = await mount([conv('wb8')])
    let err
    try { await drain(adapter) } catch (error) { err = error }
    assert.ok(err, '400/11140 应抛错')
    assert.equal(err.code, 'PERMISSION_DENIED',
      `应报 PERMISSION_DENIED（不是 QUOTA_EXCEEDED），实为 ${err.code}`)
    assert.doesNotMatch(err.message, /所有账号均受限/, '不得误报成额度受限')
  } finally { globalThis.fetch = saved }
})

if (failed > 0) { console.error(`\nchannel-buddy-conv: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-buddy-conv: 全部通过')
