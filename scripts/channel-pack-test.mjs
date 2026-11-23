/**
 * Mount the actual published bundle against host contracts in isolation.
 * No real credentials, profile directories or upstream calls are used.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { verifyChannelModelActions } from './channel-model-actions-test.mjs'
import { verifyChannelCreditsUi } from './channel-credits-ui-test.mjs'
import { verifyChannelCreditsRpc } from './channel-credits-rpc-test.mjs'
import { verifyChannelImagePricing } from './channel-image-pricing-test.mjs'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-channel-pack-'))
const kernel = new URL('./lib/channel-pack-kernel.mjs', import.meta.url).href
const hooks = registerHooks({
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
const savedFetch = globalThis.fetch
const fetched = []
globalThis.fetch = async url => {
  fetched.push(String(url))
  throw new Error('external network is disabled in the channel mount test')
}
const dispose = []
const routes = []
const adapters = new Map()
const writes = []
const creds = new Map([['OPENCODE_ACCOUNT_EXISTING', { value: '{"api_key":"test-existing-key"}' }]])
const services = {
  profileContext: { home: scratch },
  credentials: {
    resolve: async ref => creds.get(ref),
    describe: async () => undefined,
    set: async (ref, value) => { writes.push(ref); creds.set(ref, { value }) },
    unset: async ref => { writes.push(ref); creds.delete(ref) },
  },
  llm: {
    registerAdapter(providers, adapter) { for (const provider of providers) adapters.set(provider, adapter) },
    listProviders: () => [...adapters.keys()].map(id => ({ id })),
  },
  connection: { fetch: { register: route => { routes.push(route) } } },
}
const ctx = {
  ...services,
  logger: { info() {}, warn() {}, error() {} },
  get: name => services[name],
  provide(name, service) { services[name] = service; this[name] = service },
  effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') dispose.push(cleanup) },
  inject(names, callback) { if (names.every(name => services[name] !== undefined)) callback(this) },
  emit() {},
}
const state = {
  accounts: [{
    id: 'opencode-existing', provider: 'opencode', nickname: 'Existing',
    credentialRef: 'OPENCODE_ACCOUNT_EXISTING', enabled: true, refreshable: false, createdAt: 1,
  }],
  disabledModels: {},
}
fs.mkdirSync(path.join(scratch, 'channel-pack'))
fs.writeFileSync(path.join(scratch, 'channel-pack/state.json'), JSON.stringify(state))
try {
  const { apply } = await import('../vendor/channel-pack/pack.js')
  apply(ctx, { disableOpencode: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(adapters.has('opencode'), false, 'disabled account provider is not registered')
  /**
   * 渠道清单断言。
   *
   * ⚠️ **改成逐 id 核对而不是只比数字**（2026-11-23）：原先写死 `size === 15`，
   * 加 doubao 时报的是一句「all other account providers remain registered」——
   * 看不出是「少了一家」还是「多了一家」，也没说是哪家。
   * 逐 id 核对后，失败信息直接指出缺/多了谁。
   */
  const EXPECTED = [
    'codearts', 'buddy', 'workbuddy', 'lobsterai', 'qoder', 'qodercn', 'trae',
    'cline', 'loomy', 'raccoon', 'minimax', 'zcode', 'gemini',
    'officeace', 'accio', 'doubao',
  ]
  const actual = [...adapters.keys()].sort()
  const missing = EXPECTED.filter((id) => !adapters.has(id))
  assert.deepEqual(missing, [], `以下渠道未注册：${missing.join(', ')}`)
  assert.equal(adapters.size, EXPECTED.length,
    `渠道数应为 ${EXPECTED.length}（多出的是：`
    + `${actual.filter((id) => !EXPECTED.includes(id)).join(', ') || '无'}）`)
  assert.ok(adapters.has('officeace'), 'officeace（移植渠道）必须注册')
  assert.ok(adapters.has('accio'), 'accio（移植渠道）必须注册')
  // ⚠️ 四条**接线**必须真的接上 —— 这是上游 IKLTHB「哑锁」的形态：
  // 面板渲染了开关，但没有任何执行代码读它 ⇒ 开关与关闭完全一致，且**不报错**。
  // 漏装配的症状全是静默的，故这里逐条断言（`options` 在运行时可达）。
  const officeAceOptions = adapters.get('officeace').options ?? {}
  for (const key of ['credentialProvider', 'probeCredential', 'refresh', 'readImage']) {
    assert.equal(typeof officeAceOptions[key], 'function',
      `officeace 的 ${key} 必须由 index.ts 装配（漏接是静默失效）`)
  }
  verifyChannelImagePricing(adapters)
  console.log('ok  十三渠道同步图片计价：缺失及默认方法兜底，厂商计价优先，重复图片与已卸载图片正确计数')
  assert.equal(writes.length, 0, 'mount neither creates nor deletes credentials')
  assert.equal(fetched.some(url => url.includes('opencode') || url.includes('models.dev')), false, 'no OpenCode capability/catalog warmup')
  assert.deepEqual(ctx.accountPool.listAccountsByProvider('opencode'), state.accounts, 'historical account data survives')

  const route = routes.find(row => row.path === '/api/channel-pack')
  assert.ok(route, 'real RPC route is registered')
  const call = async (method, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/channel-pack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'channel-pack', payload: { method, payload } }),
    }))
    return (await response.json()).result
  }
  for (const [method, payload] of [
    ['opencode.addAccount', { apiKey: 'test-key' }],
    ['opencode.addAnonymous', {}],
    ['account.create', { provider: 'opencode' }],
  ]) {
    const result = await call(method, payload)
    assert.equal(result.ok, false, `${method} fails closed`)
    assert.equal(result.error.code, 'provider-disabled')
  }
  assert.equal((await call('account.list', { provider: 'opencode' })).value.accounts.length, 1)
  assert.equal(writes.length, 0, 'rejected RPCs leave credentials untouched')
  console.log('ok  generated pack: 15 providers (13 + officeace + accio), no OpenCode registration/warmup, historical data retained, account RPCs refused')
  await verifyChannelCreditsRpc({ ctx, call, creds })
  console.log('ok  实际渠道 RPC：七渠道仅账号池凭据即可查余额，ZCode 账号池回退及缺凭据反馈')

  // A failed browser callback must become a terminal, readable poll result.
  // Before this regression check, the Gemini placeholder was removed and
  // `login.poll` returned `{ done: false }` forever, so the UI could only show
  // its ten-minute timeout even when Google had already rejected the exchange.
  const fetchBeforeGemini = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'fixture token exchange failed' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      })
    }
    return savedFetch(input, init)
  }
  try {
    const started = (await call('account.create', { provider: 'gemini' })).value
    assert.ok(started.accountId && started.loginUrl)
    const authorization = new URL(started.loginUrl)
    const callback = new URL(authorization.searchParams.get('redirect_uri'))
    callback.searchParams.set('state', authorization.searchParams.get('state'))
    callback.searchParams.set('code', 'fixture-code')
    const callbackResponse = await savedFetch(callback)
    assert.equal(callbackResponse.status, 200)
    await new Promise(resolve => setTimeout(resolve, 50))
    const failed = (await call('login.poll', { accountId: started.accountId, provider: 'gemini' })).value
    assert.deepEqual(failed, { done: true, success: false, error: 'invalid_grant: fixture token exchange failed' })
    console.log('ok  Gemini OAuth failure: login.poll returns a terminal reason instead of waiting forever')
  } finally {
    globalThis.fetch = fetchBeforeGemini
  }

  let bundle
  const window = { __ModuleLoader__: { load: record => { bundle = record } } }
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'fragment',
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
    useMemo: callback => callback(),
    useRef: () => ({ current: null }),
    useCallback: callback => callback,
  }
  new Function('window', fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'))(window)
  const { ChannelsPage } = bundle.factory(name => {
    assert.equal(name, 'react')
    return react
  }).__test
  const tree = ChannelsPage({ t: key => key, ctx: {}, summary: { channels: { state: 'ready' } } })
  const cards = []
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node === null || typeof node !== 'object') return
    if (node.props?.channel) cards.push(node.props.channel.id)
    visit(node.children)
  }
  visit(tree)
  // 16 = 15 家原有渠道 + doubao（2026-11-23 从 gitee 上游移植）
  assert.equal(cards.length, 16)
  assert.equal(cards.includes('opencode'), false)
  assert.deepEqual([...cards].sort(), [...adapters.keys()].sort(), 'UI and mounted account providers agree')
  console.log('ok  actual channel page: 15 account cards (13 + officeace + accio), OpenCode removed')
  await verifyChannelModelActions()
  await verifyChannelCreditsUi()
  console.log('ok  共享渠道余额：十三渠道能力、失败原因、重试、签到反馈和请求交错')
  console.log('ok  共享渠道卡片：批量开关、单次请求、重复点击保护和失败恢复')

} finally {
  for (const cleanup of dispose.reverse()) await cleanup()
  globalThis.fetch = savedFetch
  hooks.deregister()
  fs.rmSync(scratch, { recursive: true, force: true })
}
