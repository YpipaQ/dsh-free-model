/**
 * OfficeAce 每日签到「失败不再静默」的回归钉子
 * （上游 890dc5f1，本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-officeace-checkin-test.mjs
 *
 * ## 钉住的两处静默（上游真实报障：「重新登录了还是没有每日积分」）
 *
 * | # | 修前 | 后果 |
 * |---|---|---|
 * | ① | `claimDailyBonus` 里 `catch { return [] }` | **零日志**，失败原因彻底消失 |
 * | ② | `maybeClaimBonus` 先占坑、失败**不撤销** | 本小时被**钉死**，后续刷新全跳过 |
 *
 * 后果链条：当日签到桶 **1000 分 23:59:59 作废**。凭据过期后连续三天每天 401 全失败、
 * 每天白丢 1000 分，日志与面板**一个字都没有**。而登录是异步写凭据库的 —— 面板刷新与
 * `login.poll` 赛跑，刷新若抢在新凭据落盘前拿到旧/空凭据 ⇒ 401 ⇒ 静默失败 ⇒
 * **该小时后续刷新全部跳过** ⇒ 一次赛跑失败 = 当天 1000 分的永久损失。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `maybeClaimBonus`（+ 桩 `fetch`）。
 * - 输出：4 条断言；全过打印 `channel-officeace-checkin: 全部通过`。
 * - 边界：纯本地、不发真实网络（`fetch` 被完全替换）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-oa-checkin-'))
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

const pack = await import('../vendor/channel-pack/pack.js')
const maybeClaim = pack.maybeClaimBonus
assert.equal(typeof maybeClaim, 'function', 'pack.js 必须导出 maybeClaimBonus')

/** 一份「凭据可用」的最小形状（`credentialUsable` 只校验 access + securityToken）。 */
const CREDENTIAL = {
  modelAppKey: 'MAK', modelAppSecret: 'MAS',
  access: 'AK', secret: 'SK', securityToken: 'STK',
  projectId: 'P1', expiresAt: '2030-01-01T00:00:00Z',
  refreshToken: 'RT',
  dpopPrivateJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
}
const REF = 'OFFICEACE_ACCOUNT_TEST'

/** 捕获 console.warn（本项目约定：失败必须留痕）。 */
const warnings = []
const realWarn = console.warn
console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }

let callCount = 0
let failMode = 'network'
globalThis.fetch = async (url) => {
  if (String(url).includes('/v1/subscription/bonus/claim')) {
    callCount++
    if (failMode === 'network') throw new Error('ECONNREFUSED 127.0.0.1:7897')
    if (failMode === 'http500') {
      return new Response('{"error_code":"OfficeAce.11020001"}', { status: 500 })
    }
    return Response.json({ bonus_skus: [{ activity_id: 'a1', activity_name: '每日签到', points: 1000 }] })
  }
  return Response.json({})
}

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 签到失败必须**留痕**（旧行为零日志）', async () => {
  warnings.length = 0
  failMode = 'network'
  await maybeClaim(CREDENTIAL, REF)
  assert.ok(warnings.length > 0,
    '签到失败必须有 console.warn（旧实现 `catch { return [] }` 零日志，'
    + `用户只能从「临期桶不见了」反推）。实际 warnings: ${JSON.stringify(warnings)}`)
  assert.ok(warnings.some((w) => w.includes('签到失败') || w.includes('credits')),
    `留痕应说清是签到失败：${JSON.stringify(warnings)}`)
})

await step('② 失败后必须**撤销占坑**，同一小时内可重试（旧行为钉死一小时）', async () => {
  warnings.length = 0
  callCount = 0
  failMode = 'network'
  // 第一次：失败
  await maybeClaim(CREDENTIAL, REF)
  assert.equal(callCount, 1, '第一次应发出签到请求')
  // 第二次（同一小时内）：**必须再发一次**（占坑已被撤销）
  await maybeClaim(CREDENTIAL, REF)
  assert.equal(callCount, 2,
    '失败后同一小时内再次刷新必须**重新尝试**（旧实现占坑不撤销 ⇒ 本小时被钉死、'
    + `当天 1000 分可能永久损失）。实发次数 ${callCount}`)
})

await step('③ 成功后**保留占坑**（同一小时不重复打服务端）', async () => {
  warnings.length = 0
  failMode = 'ok'
  // 先用一个**独立的 ref**，避免受上一格状态影响
  const freshRef = 'OFFICEACE_ACCOUNT_OK'
  callCount = 0
  const first = await maybeClaim(CREDENTIAL, freshRef)
  assert.equal(callCount, 1, '第一次应发请求')
  assert.ok(Array.isArray(first) && first.length > 0, '应领到活动桶')
  // 同小时再调：**不得再发**（节流生效）
  await maybeClaim(CREDENTIAL, freshRef)
  assert.equal(callCount, 1,
    `领取成功后同一小时不得重复请求（节流），实发 ${callCount} 次`)
})

await step('④ 撤销必须是**条件删**（跨整点不许删掉新一轮的占坑）', async () => {
  // 源码级断言：撤销走 `releaseSlot` 且带 hourKey 条件
  const src = fs.readFileSync(
    new URL('../vendor/channel-pack/src/officeace-auth.ts', import.meta.url), 'utf8')
  const seg = src.slice(src.indexOf('export function maybeClaimBonus'))
  assert.match(seg.slice(0, 2200), /const releaseSlot = \(\): void => \{/,
    '应有 releaseSlot（撤销占坑的唯一入口）')
  assert.match(seg.slice(0, 2200), /if \(lastClaimAt\.get\(ref\) === hourKey\) lastClaimAt\.delete\(ref\)/,
    '撤销必须**条件删**（只在当前 hourKey 仍是自己那格时才删）—— 无条件删会在跨整点时'
    + '把新一轮刷新重建的占坑删掉（节流失效）')
  // 且失败分支必须调用它
  assert.match(seg.slice(0, 2600), /\.catch\(\(error: unknown\) => \{[\s\S]{0,400}?releaseSlot\(\)/,
    '失败分支必须调用 releaseSlot（否则本小时被钉死）')
})

console.warn = realWarn
if (failed > 0) { console.error(`\nchannel-officeace-checkin: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-officeace-checkin: 全部通过')
