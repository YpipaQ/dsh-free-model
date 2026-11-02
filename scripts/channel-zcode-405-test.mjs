/**
 * ZCode `405` 恒不可重试的回归钉子
 * （上游 758a20bc / Gitee IKQ4B4，本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-zcode-405-test.mjs
 *
 * ## 钉住的缺陷（「越重试越糟」）
 *
 * `405` 在 ZCode **从不是**「HTTP 方法不允许」—— 它是**风控拦截的专属状态码**
 *（消融矩阵：裸请求 / 无身份块都是「405 + 3012」）。而上游有时把拦截包成**边缘
 * CDN 的 HTML 页**（`<title>405</title>`，无业务码、无风控语义）。
 *
 * 旧实现落进 `return 'SERVER'` ⇒ 它在 harness 的 `DEFAULT_RETRYABLE_CODES` 里
 * ⇒ **白重试 5 轮**，每轮都真实打到上游。而 `3012` 有**账号冷却惩罚**（30 分钟起，
 * 反复触发升级到 24 小时乃至停用）⇒ 对 405 重试不只是无用，是**有害**的。
 *
 * 实测 retry 链（上游会话逐字）：`1/5 476ms → 2/5 950ms → 3/5 1928ms →
 * 4/5 4107ms → 5/5 7237ms`，全部 `code SERVER status 405`。
 *
 * ## 三个邻位（缺一个就判错）
 *
 * | 邻位 | 错放的后果 |
 * |---|---|
 * | 在**权威业务码之后** | `{"code":1005}` + 405 被吞，本该是 `QUOTA_EXCEEDED` |
 * | 码**不取 `PERMISSION`** | 既有守卫钉住「PERMISSION ⟺ 风控语义」，405 页没有风控语义 |
 * | 与 `>=500` / `400` 判据**互斥** | — |
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `httpErrorCodeForZcode`（纯判据函数）。
 * - 输出：5 条断言；全过打印 `channel-zcode-405: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-zcode-405-'))
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
const classify = pack.httpErrorCodeForZcode
assert.equal(typeof classify, 'function', 'pack.js 必须导出 httpErrorCodeForZcode')

/** harness 的可重试码集合（`DEFAULT_RETRYABLE_CODES`，从本仓库多处注释可查）。 */
const RETRYABLE = new Set(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'])

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 405 + 边缘 HTML 页 ⇒ 不可重试（旧行为是 SERVER，白重试 5 轮）', async () => {
  const code = classify(405, '<html><head><title>405</title></head><body>Not Allowed</body></html>')
  assert.ok(!RETRYABLE.has(code),
    `405 的码不得落在可重试集合里（否则 harness 白重试 5 轮、每轮真打上游，`
    + `还会累积 3012 的账号冷却惩罚）。实得 ${code}`)
  assert.equal(code, 'PERMISSION_DENIED', `应归 PERMISSION_DENIED，实得 ${code}`)
})

await step('② 405 + 空体 / 纯文本 也同样不可重试', async () => {
  for (const body of ['', '  ', 'Not Allowed', '405 Not Allowed']) {
    const code = classify(405, body)
    assert.ok(!RETRYABLE.has(code),
      `405（body=${JSON.stringify(body)}）不得归可重试码，实得 ${code}`)
  }
})

await step('③ 邻位一：有权威业务码时**不得**被 405 吞掉', async () => {
  // `{"code":1005}` + 405 必须仍是 QUOTA_EXCEEDED（上游实测的真实回归）
  assert.equal(classify(405, '{"code":1005}'), 'QUOTA_EXCEEDED',
    '带权威业务码 1005 的 405 必须归 QUOTA_EXCEEDED（不能被 405 分支吞掉）')
  // 1113 余额不足
  assert.equal(classify(405, '{"code":1113}'), 'QUOTA_EXCEEDED')
  // 风控语义（3012）优先
  const unusual = classify(405, '{"code":3012,"msg":"unusual activity"}')
  assert.equal(unusual, 'PERMISSION',
    '风控语义必须仍归 PERMISSION（那是有风控证据的专属码）')
})

await step('④ 邻位二：405 的码**不能**取 PERMISSION（那个码等价于「有风控语义」）', async () => {
  // 无业务码的 405 页没有风控语义 ⇒ 不得归 PERMISSION
  assert.notEqual(classify(405, '<html><title>405</title></html>'), 'PERMISSION',
    '405 页没有风控语义，不得归 PERMISSION（既有守卫钉住「PERMISSION ⟺ 风控语义」）')
})

await step('⑤ 邻位三：其它状态码的分类不变（405 分支必须互斥）', async () => {
  // 回归：不得因为加了 405 分支而改动别人的分类
  assert.equal(classify(503, 'backend unavailable'), 'SERVER', '503 仍 SERVER')
  assert.equal(classify(400, 'bad request'), 'INVALID_REQUEST', '400 仍 INVALID_REQUEST')
  assert.equal(classify(429, 'rate limited'), 'RATE_LIMIT', '429 仍 RATE_LIMIT')
  assert.equal(classify(401, ''), 'AUTH', '401 仍 AUTH')
  assert.equal(classify(400, '{"code":3007}'), 'RATE_LIMIT', '3007 仍 RATE_LIMIT')
})

if (failed > 0) { console.error(`\nchannel-zcode-405: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-zcode-405: 全部通过')
