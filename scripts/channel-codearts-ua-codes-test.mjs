/**
 * CodeArts 两个「整条渠道不可用 / 错误归因错」缺陷的回归钉子
 * （上游 `378ffd73` UA 覆盖 + `104f0fc3` 三业务码单列，本 fork 2026-11-09 移植）。
 *
 *     node scripts/channel-codearts-ua-codes-test.mjs
 *
 * ## 钉住的两件事
 *
 * ### ① `User-Agent` 必须覆盖成官方 IDE 身份
 *
 * 宿主的 `attributionHeaders()` 恒发 `deepseek-harness/<ver> (+…)`，而**华为 WAF
 * 按大小写敏感的前缀 `deepseek-harness/` 拒发** ⇒ `403 TM.00000001`。
 * 而 403 落到 `AUTH` ⇒ 客户端把整条 message 换成「**API 密钥无效**」⇒ 用户以为
 * 凭据坏了去重登，而**凭据完全有效**；且每次失败还**白跑一次一次性 STS 续期**。
 *
 * 实测对照（同账号/同签名/逐字节同 body，只改 UA）：`deepseek-harness/0.2.1` ⇒ 403；
 * `deepseek-harness`（无 `/`）⇒ 200；`VSCode` / `curl` / `claude-code` ⇒ 200。
 *
 * ### ② 三个「非凭据问题」业务码必须单列（且码不能相同）
 *
 * | 业务码 | 成因 | 重试有效 | 归码 |
 * |---|---|---|---|
 * | `TM.00000001` | WAF 按 UA 拒发（**不是真繁忙**） | 否 | `PERMISSION` |
 * | `TM.00001041` | 账号级并发上限 | **是**（1~2 分钟 / 换号） | `RATE_LIMIT` |
 * | `TM.000010051` | 模型未在本租户开通 | 否 | `PERMISSION` |
 *
 * ⚠️ 把 `TM.00000001` 也归 `RATE_LIMIT` 会让确定性失败白重试 5 次。
 * ⚠️ 判据必须**精确到数字边界**：`includes('TM.00000001')` 会命中 `TM.000000011`。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `CODEARTS_USER_AGENT` / `codeartsHttpErrorCode` /
 *   `codeartsIsAuthError`（测试专用导出）。
 * - 输出：6 条断言；全过打印 `channel-codearts-ua-codes: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-ca-ua-'))
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
const { CODEARTS_USER_AGENT, codeartsHttpErrorCode: classify, codeartsIsAuthError: isAuth } = pack
assert.equal(typeof classify, 'function', 'pack.js 必须导出 codeartsHttpErrorCode')
assert.equal(typeof isAuth, 'function', 'pack.js 必须导出 codeartsIsAuthError')
assert.equal(typeof CODEARTS_USER_AGENT, 'string', 'pack.js 必须导出 CODEARTS_USER_AGENT')

/** harness 的可重试码集合（`DEFAULT_RETRYABLE_CODES`）。 */
const RETRYABLE = new Set(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'])

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① UA 不得以 `deepseek-harness/` 开头（WAF 按该前缀拒发）', async () => {
  assert.ok(!/^deepseek-harness\//i.test(CODEARTS_USER_AGENT),
    'UA 不能以 deepseek-harness/ 开头（华为 WAF 按该大小写敏感前缀拒发 ⇒ 403 '
    + `TM.00000001 ⇒ 客户端误报「API 密钥无效」）。实得: ${CODEARTS_USER_AGENT}`)
  assert.match(CODEARTS_USER_AGENT, /^codearts\//,
    `UA 应是官方 IDE 身份形态（实测 VSCode/codearts 这类首 token 放行）。实得: ${CODEARTS_USER_AGENT}`)
})

await step('② 推理请求**真的**设置了该 UA（不只定义了常量）', async () => {
  const src = fs.readFileSync(
    new URL('../vendor/channel-pack/src/llm-adapter.ts', import.meta.url), 'utf8')
  const i = src.indexOf("headers.set('User-Agent'")
  assert.ok(i > 0, '推理请求处必须 `headers.set(\'User-Agent\', …)`（只定义常量不设 = 死代码）')
  assert.match(src.slice(i, i + 120), /CODEARTS_USER_AGENT/,
    'UA 覆盖必须用 CODEARTS_USER_AGENT（别另写字面量，否则两处漂移）')
  // 且必须在 attributionHeaders() 之后（否则被宿主默认值覆盖）
  const attrAt = src.lastIndexOf('new Headers(attributionHeaders())', i)
  assert.ok(attrAt > 0 && attrAt < i,
    'UA 覆盖必须在 `new Headers(attributionHeaders())` **之后**（否则被宿主默认值覆盖）')
})

await step('③ 三个业务码的归码互不相同且语义正确', async () => {
  const waf = classify(403, '{"error_code":"TM.00000001","error_msg":"网络繁忙，请稍后重试"}')
  const conc = classify(403, '{"error_code":"TM.00001041","error_msg":"并发会话数已达上限"}')
  const notOpen = classify(403, '{"error_code":"TM.000010051","error_msg":"模型未开通"}')
  assert.equal(waf, 'PERMISSION',
    `TM.00000001（WAF 按 UA 拒发，不是真繁忙）必须归 PERMISSION，实得 ${waf}`)
  assert.equal(conc, 'RATE_LIMIT',
    `TM.00001041（并发上限，等 1~2 分钟可解）必须归 RATE_LIMIT，实得 ${conc}`)
  assert.equal(notOpen, 'PERMISSION',
    `TM.000010051（模型未开通）必须归 PERMISSION，实得 ${notOpen}`)
  // ⚠️ 核心：WAF 那条**绝不能**归 RATE_LIMIT（否则白重试 5 次）
  assert.ok(!RETRYABLE.has(waf),
    `TM.00000001 不得归可重试码（宿主 DEFAULT_RETRYABLE_CODES 含 RATE_LIMIT，`
    + `确定性失败会白退避重试 5 次、每次真打上游一次 403）。实得 ${waf}`)
  // 并发上限**必须**可重试（等一会儿就好）
  assert.ok(RETRYABLE.has(conc),
    `TM.00001041 应可重试（等 1~2 分钟即好），实得 ${conc}`)
})

await step('④ 业务码判据必须有数字边界（不许子串命中）', async () => {
  // `TM.000000011` 是**另一个**码，不得被 `TM.00000001` 的判据命中
  const longer = classify(403, '{"error_code":"TM.000000011"}')
  assert.equal(longer, 'AUTH',
    `TM.000000011 不该被 TM.00000001 的判据命中（必须用数字边界），实得 ${longer}`)
})

await step('⑤ `isAuthError`：两个非凭据业务码的 403 **不得**触发续期', async () => {
  // ⚠️ CodeArts 的 refresh_token 是**一次性轮换**的 ⇒ 每次白跑都真消耗一次
  assert.equal(isAuth(403, '{"error_code":"TM.00000001"}'), false,
    'WAF 拒发的 403 不是凭据问题，**不得**触发续期（白烧一次性 refresh_token）')
  assert.equal(isAuth(403, '{"error_code":"TM.000010051"}'), false,
    '模型未开通的 403 不是凭据问题，不得触发续期')
  // 真正的凭据问题仍要续期
  assert.equal(isAuth(401, ''), true, '401 仍应触发续期（语义就是未认证）')
  assert.equal(isAuth(403, '{"error_code":"APIG.0602","error_msg":"Invalid token"}'), true,
    'APIG.0602（真凭据失效）仍应触发续期')
  assert.equal(isAuth(403, '{"error_msg":"token expired"}'), true,
    'token 失效文案仍应触发续期')
})

await step('⑥ 其它 403 与状态码分类不变（回归）', async () => {
  assert.equal(classify(403, '{"error_msg":"forbidden"}'), 'AUTH',
    '普通 403 仍归 AUTH（无业务码时语义不变）')
  assert.equal(classify(401, ''), 'AUTH', '401 仍 AUTH')
  assert.equal(classify(429, ''), 'RATE_LIMIT', '429 仍 RATE_LIMIT')
  assert.equal(classify(503, ''), 'SERVER', '503 仍 SERVER')
})

if (failed > 0) { console.error(`\nchannel-codearts-ua-codes: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-codearts-ua-codes: 全部通过')
