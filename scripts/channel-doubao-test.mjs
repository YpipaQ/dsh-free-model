/**
 * 豆包（doubao）渠道的回归钉子
 * （照上游 0ea3e43e，本 fork 2026-11-23 移植）。
 *
 *     node scripts/channel-doubao-test.mjs
 *
 * ## 钉住什么
 *
 * 1. **设备身份是确定性派生**（19 位纯数字）—— 豆包网页端按设备指纹风控，
 *    每次随机会让同一账号表现为「陌生设备」。
 * 2. **`verify_…` / `ttwid` 这类预验证 id 必须被拒**（多账号实测 `710010702`
 *    的根因之一：把未注册的预验证 id 当成了设备号）。
 * 3. **DSML 流式归一化必须跨帧正确**（双竖线笔误修得掉，且不误伤正常文本）。
 * 4. **签到排除表含 doubao** —— 本 fork 未移植 `doubao-signin.ts`（CDP 浏览器
 *    405 行），若不在排除表里，自动签到会去尝试一条根本不存在的能力。
 * 5. **渠道已注册到适配器清单**（否则模型选择器里根本看不到它）。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的纯函数 + 源码级结构断言。
 * - 输出：7 条断言；全过打印 `channel-doubao: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-doubao-'))
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
const {
  doubaoDerivedDeviceIdentity, doubaoDeviceIdentityOf, parseDoubaoCredential,
  sessionIdFromCookie, createDsmlMarkerNormalizer, fixDsmlMarkers, isAutoCheckinExcluded,
} = pack

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 设备身份确定性派生：同一账号恒定，且是 19 位纯数字', async () => {
  const a = doubaoDerivedDeviceIdentity('account-abc')
  const b = doubaoDerivedDeviceIdentity('account-abc')
  assert.deepEqual(a, b, '同一 accountKey 必须派生出同一套设备身份（否则被打成陌生设备）')
  assert.equal(a.deviceId.length, 19, `device_id 应是 19 位，实得 ${a.deviceId.length}`)
  assert.match(a.deviceId, /^\d{19}$/, 'device_id 必须全数字')
  assert.match(a.webId, /^\d{19}$/, 'web_id 必须全数字')
  assert.match(a.teaUuid, /^\d{19}$/, 'tea_uuid 必须全数字')
  // 不同账号必须不同（否则多账号会互相顶号）
  const c = doubaoDerivedDeviceIdentity('account-xyz')
  assert.notEqual(a.deviceId, c.deviceId, '不同账号必须派生不同 device_id')
})

await step('② ⚠️ `verify_…` / `ttwid` 形态的预验证 id 必须被拒（改走派生）', async () => {
  // 上游实测：这类值是「预验证 id」，服务端没注册过 ⇒ 710010702 的根因之一
  const credential = {
    accountKey: 'seed-key',
    cookie: 'sessionid=sess-1; ttwid=abc%7C123',
    deviceId: 'verify_abc123',      // ← 非法形态，必须被忽略
    webId: 's_v_web_id_xyz',        // ← 同
  }
  const identity = doubaoDeviceIdentityOf(credential)
  assert.notEqual(identity.deviceId, 'verify_abc123',
    'verify_ 形态的设备号必须被拒（未注册的预验证 id ⇒ 710010702）')
  assert.notEqual(identity.webId, 's_v_web_id_xyz', '同上的 web_id')
  // 落到确定性派生
  assert.deepEqual(identity, doubaoDerivedDeviceIdentity('seed-key'),
    '非法形态必须回落到按 accountKey 的确定性派生')
})

await step('③ 合法形态（15~21 位纯数字）的设备号应当原样采用', async () => {
  const stored = '1234567890123456789'   // 19 位
  const identity = doubaoDeviceIdentityOf({ accountKey: 'k', cookie: 'x=1', deviceId: stored })
  assert.equal(identity.deviceId, stored, '已注册形态的设备号应原样沿用（那是真实客户端给的）')
})

await step('④ accountKey 缺席时用 cookie 的 sessionid 当种子', async () => {
  const cookie = 'a=1; sessionid=my-session; b=2'
  assert.equal(sessionIdFromCookie(cookie), 'my-session', '应从 cookie 串里抠出 sessionid')
  const id1 = doubaoDeviceIdentityOf({ cookie })
  const id2 = doubaoDeviceIdentityOf({ cookie })
  assert.deepEqual(id1, id2, '同一 cookie 必须派生同一套身份（账号稳定）')
  assert.equal(sessionIdFromCookie(undefined), undefined, '无 cookie 时应返回 undefined')
})

await step('⑤ DSML 双竖线笔误可修（整段入口）', async () => {
  assert.equal(fixDsmlMarkers('<｜｜DSML｜｜tool_calls>'), '<｜DSML｜tool_calls>',
    '前缀双竖线必须修成单竖线（否则 parseDsmlToolCalls 整块解析失败）')
  assert.equal(fixDsmlMarkers('<｜DSML｜｜invoke name="x">'), '<｜DSML｜invoke name="x">',
    '后缀双竖线也必须修（含紧跟字母的实测形态）')
  // 正常单竖线不得被改坏
  const ok = '<｜DSML｜tool_calls>'
  assert.equal(fixDsmlMarkers(ok), ok, '正常形态必须原样返回（幂等）')
})

await step('⑥ ⚠️ DSML 流式归一化必须跨帧正确（逐帧 replace 会漏判）', async () => {
  const normalizer = createDsmlMarkerNormalizer()
  // 把 "<｜｜DSML｜｜tool_calls>" 拆成逐字符喂入 —— 模式必然跨帧
  const input = '<｜｜DSML｜｜tool_calls>'
  let out = ''
  for (const ch of input) out += normalizer.push(ch)
  out += normalizer.flush()
  assert.equal(out, '<｜DSML｜tool_calls>',
    `跨帧喂入后必须拼出正确的归一化结果。实得 ${JSON.stringify(out)}`
    + '（逐帧 replace 每帧只见半截模式 ⇒ 漏判，这正是流式版本存在的理由）')
})

await step('⑦ 签到排除表含 doubao（本 fork 未移植 CDP 签到那条腿）', async () => {
  assert.equal(isAutoCheckinExcluded('doubao'), true,
    '豆包必须在自动签到排除表里 —— 签到要走 a_bogus + CDP 浏览器（上游 doubao-signin.ts 405 行），'
    + '本 fork 未移植 ⇒ 不排除会去尝试一条不存在的能力')
  assert.equal(isAutoCheckinExcluded('zcode'), true, 'zcode 原有的排除必须保留')
  assert.equal(isAutoCheckinExcluded('buddy'), false, '普通渠道**不得**被误排除')
})

await step('⑧ 渠道已接线：适配器注册 + 前端卡片 + 模型目录', async () => {
  const idx = read('vendor/channel-pack/src/index.ts')
  assert.match(idx, /registerDoubaoLlm\(ctx, \{/, 'index.ts 必须实例化注册 doubao 适配器')
  assert.match(idx, /doubao: pruned\(/, 'modelAdapters 必须登记 doubao（否则选择器看不到）')
  // 前端卡片：UI 与后端 provider 必须一致（channel-pack 套件有交叉断言）
  const client = read('client.js')
  assert.match(client, /id: 'doubao'/, '前端渠道卡必须有 doubao 条目')
  // 四个源文件都得在
  for (const f of ['doubao.ts', 'doubao-upstream.ts', 'doubao-adapter.ts', 'doubao-credits.ts']) {
    assert.ok(fs.existsSync(path.join(root, 'vendor/channel-pack/src', f)), `缺少 ${f}`)
  }
})

if (failed > 0) { console.error(`\nchannel-doubao: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-doubao: 全部通过')
