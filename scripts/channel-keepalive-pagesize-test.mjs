/**
 * 上游 2026-11-23 两条修复的回归钉子：
 * A1 buddy 续期保活（`77a0e87a` / issue #124）
 * A4 minimax 余额分页（`a95ac6d6` / issue #141）
 *
 *     node scripts/channel-keepalive-pagesize-test.mjs
 *
 * ## A1 钉住什么
 *
 * Buddy 的 `access_token` TTL **以天计**（上游实测 60 / 30 / 28 天且在收缩），
 * 而 lead-time 判据只在「距过期不足 1 小时」放行 ⇒ 调度器每 30 分钟一轮
 * **每轮都被跳过** ⇒ `refresh_token` 闲置 28 天被服务端作废：
 *
 *     POST /v2/plugin/auth/token/refresh → 401 {"code":12153,"msg":"refresh token is invalid"}
 *
 * ⇒ 用户看到「凭据过期 / API 密钥无效」，**只能重新登录**。
 *
 * 修法：加**保活腿** —— `now - iat >= 7 天` 就续一次（`iat` = 上次刷新时刻）。
 *
 * ⚠️ 三条必须守住的边界（上游实测依据）：
 * 1. **`issuedAtOf` 读不到 ⇒ fail-open 跳过**（不是 fail-closed）—— 否则所有
 *    解不出 JWT 的凭据会每 30 分钟白刷一次；
 * 2. **绝不改 `REFRESH_LEAD_MS`** —— 那是九家共用的，改大等于让 codearts /
 *    officeace 这类 TTL≈1h 的渠道每轮都续期，把一次性 refresh_token 烧光；
 * 3. **其余八家行为逐字节不变**（它们不提供 `issuedAtOf`）。
 *
 * ## A4 钉住什么
 *
 * `credit/details` 默认**只返回最近 20 个积分包**，而我们把可见包的
 * `remaining_amount` 求和当余额 ⇒ 被挤出窗口的包额度**从界面消失**，
 * 且**误差随天数单调扩大**（「签到成功、积分不涨」的真因）。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `shouldRefreshNow` / `KEEPALIVE_MAX_IDLE_MS`，
 *   以及 minimax 余额源码。
 * - 输出：8 条断言；全过打印 `channel-keepalive-pagesize: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-keepalive-'))
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
fs.mkdirSync(path.join(scratch, 'channel-pack'), { recursive: true })
fs.writeFileSync(path.join(scratch, 'channel-pack/state.json'), JSON.stringify({
  accounts: [], disabledModels: {},
}))

const root = path.join(new URL('..', import.meta.url).pathname)
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const pack = await import('../vendor/channel-pack/pack.js')
const { shouldRefreshNow, KEEPALIVE_MAX_IDLE_MS } = pack
assert.equal(typeof shouldRefreshNow, 'function', 'pack.js 必须导出 shouldRefreshNow')
assert.equal(typeof KEEPALIVE_MAX_IDLE_MS, 'number', 'pack.js 必须导出 KEEPALIVE_MAX_IDLE_MS')

const DAY = 24 * 60 * 60 * 1000
let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 保活常量 = 7 天（不是比例，与 TTL 无关）', async () => {
  assert.equal(KEEPALIVE_MAX_IDLE_MS, 7 * DAY,
    `保活上限应为 7 天整（上游实测：Buddy TTL 60/30/28 天且持续收缩，`
    + `按比例会贴到闲置窗口红线）。实得 ${KEEPALIVE_MAX_IDLE_MS / DAY} 天`)
})

await step('② 闲置满 7 天 ⇒ 必须续（这是本缺陷的核心）', async () => {
  const now = Date.parse('2026-11-23T12:00:00Z')
  // access 还能活 30 天（远超 lead-time），但上次刷新是 8 天前
  const expiresAt = now + 30 * DAY
  const issuedAt = now - 8 * DAY
  assert.equal(shouldRefreshNow(expiresAt, now, undefined, issuedAt), true,
    'access 剩 30 天但已 8 天没续 ⇒ 必须保活续期（否则 refresh_token 闲置作废）')
})

await step('③ 闲置未满 7 天 ⇒ 不续（不许变成每轮都刷）', async () => {
  const now = Date.parse('2026-11-23T12:00:00Z')
  const expiresAt = now + 30 * DAY
  assert.equal(shouldRefreshNow(expiresAt, now, undefined, now - 6 * DAY), false,
    '只闲置 6 天不应续期（每 30 分钟白刷会把一次性 refresh_token 烧光）')
  assert.equal(shouldRefreshNow(expiresAt, now, undefined, now - 1 * DAY), false,
    '闲置 1 天不应续期')
})

await step('④ ⚠️ fail-open：issuedAt 读不到 ⇒ 跳过保活腿（不是判「需要刷」）', async () => {
  const now = Date.parse('2026-11-23T12:00:00Z')
  const expiresAt = now + 30 * DAY
  assert.equal(shouldRefreshNow(expiresAt, now, undefined, undefined), false,
    '读不到签发时刻必须退回旧行为（不续）—— 否则所有解不出 JWT 的凭据会被白刷')
  assert.equal(shouldRefreshNow(expiresAt, now, undefined, Number.NaN), false,
    'NaN 同样跳过（fail-open）')
})

await step('⑤ ⚠️ 保活腿不得破坏前两腿（三腿取「或」）', async () => {
  const now = Date.parse('2026-11-23T12:00:00Z')
  // access 快过期，但刚续过（iat = now）⇒ 仍要续（access 腿生效）
  assert.equal(shouldRefreshNow(now + 10 * 60 * 1000, now, undefined, now), true,
    'access 剩 10 分钟必须续（哪怕刚续过）')
  // access 还好，但 refresh 快死 ⇒ 仍要续（refresh 腿生效）
  assert.equal(shouldRefreshNow(now + 30 * DAY, now, now + 10 * 60 * 1000, now), true,
    'refresh 剩 10 分钟必须续（refresh 寿命腿）')
  // 读不到 access 过期时刻 ⇒ 恒续（原有语义不变）
  assert.equal(shouldRefreshNow(undefined, now, undefined, now), true,
    'access 过期时刻读不到 ⇒ 恒需要续（既有语义，不得被保活腿改掉）')
})

await step('⑥ ⚠️ REFRESH_LEAD_MS 不得被改动（九家共用，改大烧一次性 token）', async () => {
  // ⚠️ 常量实际定义在 `refresh.ts`（`expiry-sync.ts` 只是 import 它）
  const src = read('vendor/channel-pack/src/refresh.ts')
  const m = /export const REFRESH_LEAD_MS = ([^\n]+)/.exec(src)
  assert.ok(m, '应有 REFRESH_LEAD_MS 常量（refresh.ts）')
  assert.match(m[1], /60\s*\*\s*60\s*\*\s*1000|3600_000|3_600_000/,
    `REFRESH_LEAD_MS 必须仍是 1 小时。实得 ${m[1]} —— 改大等于让 codearts/officeace `
    + '这类 TTL≈1h 的渠道每轮都续期，把一次性 refresh_token 全烧光（2026-10-27 两次同型事故）')
})

await step('⑦ 其余八家不提供 issuedAtOf ⇒ 行为逐字节不变', async () => {
  // 只有 buddy 的 accessors 该有 issuedAtOf
  const files = ['llm-adapter.ts', 'cline-adapter.ts', 'trae-adapter.ts',
    'lobsterai-adapter.ts', 'loomy-adapter.ts', 'raccoon-adapter.ts',
    'minimax-adapter.ts', 'zcode-adapter.ts', 'accio-adapter.ts', 'gemini-adapter.ts']
  for (const f of files) {
    const src = read(`vendor/channel-pack/src/${f}`)
    assert.doesNotMatch(src, /issuedAtOf:/,
      `${f} **不应**提供 issuedAtOf —— 保活腿只给 buddy/workbuddy（TTL 以天计的渠道）`)
  }
  const buddySrc = read('vendor/channel-pack/src/buddy-auth.ts')
  assert.match(buddySrc, /issuedAtOf: \(credential\) => jwtIssuedAtMs\(/,
    'buddy 必须提供 issuedAtOf（指向 access_token 的 iat）')
})

await step('⑨ A2：zcode 营销门槛 = 3.18.2，并且**推理门槛必须仍是 3.17.1**', async () => {
  const src = read('vendor/channel-pack/src/zcode-upstream.ts')
  const mk = /export const ZCODE_MARKETING_MIN_APP_VERSION = '([^']+)'/.exec(src)
  const inf = /export const ZCODE_INFERENCE_MIN_APP_VERSION = '([^']+)'/.exec(src)
  assert.ok(mk, '应有 ZCODE_MARKETING_MIN_APP_VERSION（营销/领取门槛）')
  assert.ok(inf, '应有 ZCODE_INFERENCE_MIN_APP_VERSION（推理门槛）')
  assert.equal(mk[1], '3.18.2',
    `营销门槛应为 3.18.2（1120 期 WEEKEND BUILD 实测：3.18.1 deliveries 空、3.18.2 起拿到`
    + ` plan_id=zcode-v3-start-plan-wk-1120 / grant_units=500000000）。实得 ${mk[1]}`)

  // ⚠️⚠️ **核心不变式**：推理门槛与身份块成对校验，**绝不能**跟着抬到 3.18.2
  assert.equal(inf[1], '3.17.1',
    `推理门槛必须仍是 3.17.1 —— 它与 system 身份块**按代次成对校验**，`
    + `抬到 3.18.2 会触发全量 405+3012。实得 ${inf[1]}`)
  assert.notEqual(mk[1], inf[1],
    '两个门槛**必须不同值**：合并成一个常量就是把推理路径也抬上去 ⇒ 全量 3012')
})

await step('⑩ A2：营销/领取路径必须用营销门槛（不是推理门槛）', async () => {
  const src = read('vendor/channel-pack/src/zcode-upstream.ts')
  // 两处领取：预览（GET）与 claim（POST）
  /**
   * ⚠️ **必须恰好 3 处**用营销门槛（两处 `const appVersion = …` + 一处 `appVersion: …`）。
   *
   * 这个数字不是拍脑袋：变异实测发现「写 `>= 1`」或「写 `=== 1`」都能被绕过 ——
   * 领取路径有**两处**（预览 GET / 计划摘要 GET），改掉其中一处另一个还在，
   * 计数仍然满足。⇒ 必须钉**精确总数**。
   */
  const marketingCalls = [...src.matchAll(/zcodeMarketingAppVersion\(credential\)/g)]
  assert.equal(marketingCalls.length, 3,
    `营销门槛必须用在**恰好 3 处**（领取预览 / 计划摘要 / claim 请求头）。`
    + `实得 ${marketingCalls.length} 处 —— 少一处就意味着那条路径用了推理门槛`
    + `（版本低 ⇒ deliveries 空 / 1004 no permission）`)
  assert.match(src, /appVersion: zcodeMarketingAppVersion\(credential\)/,
    'claim 端点（POST）也必须带营销门槛（版本低 ⇒ 1004 no permission）')
  // 反向：不能把推理路径也改成营销门槛
  const infCalls = [...src.matchAll(/options\.appVersion \?\? zcodeInferenceAppVersion/g)]
  assert.ok(infCalls.length === 1,
    'buildZcodeHeaders 默认必须仍走推理门控（营销门槛只经显式 appVersion 传入）')
})

await step('⑧ A4：minimax 余额必须带 page_size=1000（否则只算前 20 个包）', async () => {
  const src = read('vendor/channel-pack/src/minimax-credits.ts')
  const m = /const url = `\$\{product\.apiHost\}\$\{MINIMAX_CREDIT_DETAILS_PATH\}([^`]*)`/.exec(src)
  assert.ok(m, '应能找到 minimax 余额 url 构造')
  assert.equal(m[1], '?page_size=1000',
    `余额 url 必须带 ?page_size=1000（默认只返回最近 20 个包 ⇒ 被挤出的包额度`
    + `从界面消失，且误差随天数单调扩大）。实得 "${m[1]}"`)
})
