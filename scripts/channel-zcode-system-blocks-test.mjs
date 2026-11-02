/**
 * ZCode「system 数组恒为 3 块」的回归钉子
 * （上游 9893e916，本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-zcode-system-blocks-test.mjs
 *
 * ## 钉住的缺陷（整条渠道不可用）
 *
 * 官方客户端的 `system` 数组**恒为 3 块**（cli_prefix + stable + dynamic）。
 * 旧实现把调用方 system **追加为第 4 块** ⇒ 上游回 `HTTP 405 + 3012
 * unusual activity`。
 *
 * 上游三轮对照实验（同一账号 / 同一 URL / 同一组 18 个请求头，**只改请求体**）：
 *
 * | system 块数 | 结果 |
 * |---|---|
 * | **3 块**（42 + 2590 + 253） | ✅ HTTP 200 |
 * | **4 块**（第 4 块 = 调用方 system，2 062 字符） | ❌ **405 + 3012** |
 * | 4 块（同上，25 428 字符） | ❌ 405 + 3012 |
 * | 3 块 + 调用方内容改放进 messages | ✅ HTTP 200 |
 *
 * ⇒ **判据是「块数」，与第 4 块多长无关**。
 *
 * ⚠️ 本 fork **无号可测**，故这条完全依赖上游的实验结论 + 本地产出物形状断言
 * （不依赖任何「上游行为可能变」的假设）。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `buildZcodeSystemBlocks` / `withCallerSystem`（测试专用）。
 * - 输出：5 条断言；全过打印 `channel-zcode-system-blocks: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-zcode-sys-'))
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
const buildBlocks = pack.buildZcodeSystemBlocks
const withCaller = pack.withCallerSystem
assert.equal(typeof buildBlocks, 'function', 'pack.js 必须导出 buildZcodeSystemBlocks')
assert.equal(typeof withCaller, 'function', 'pack.js 必须导出 withCallerSystem')

const OPTIONS = {
  cwd: '/tmp/fixture-workdir',
  provider: 'zcode',
  model: 'glm-5.3',
}

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① buildZcodeSystemBlocks 恒产出 **3 块**（第 4 块会让上游回 405+3012）', async () => {
  const blocks = buildBlocks(OPTIONS)
  assert.equal(blocks.length, 3,
    `system 数组必须恒为 3 块（上游判据是块数，与内容长度无关）。实得 ${blocks.length} 块`
    + `（这会让整条渠道回 405 + 3012 unusual activity）`)
  // 第一块必须是官方 cliPrefix（3012 的唯一判据之一）
  assert.ok(typeof blocks[0]?.text === 'string' && blocks[0].text.length > 0,
    '第一块必须有文本（官方 cliPrefix）')
})

await step('② 无论调用方 system 多长，system 数组都还是 3 块', async () => {
  // 旧实现会把 callerSystem 追加成第 4 块 ⇒ 块数随「有没有 caller」而变 ⇒ 这条钉子专抓它
  const short = buildBlocks(OPTIONS)
  assert.equal(short.length, 3, '无 caller 时 3 块')
  // 若实现回退成「接收 callerSystem 参数并 push」，下面的调用签名会变；
  // 这里同时断言**签名**已改为只收 options（用 arguments.length 判不了泛型，
  // 故用「传第二个参数也不影响块数」来验证）
  const withExtra = buildBlocks(OPTIONS, 'a'.repeat(2062))
  assert.equal(withExtra.length, 3,
    `传了调用方 system 作为第二参时也必须仍是 3 块（上游实测 2 062 字符的第 4 块照样 405）。`
    + `实得 ${withExtra.length} 块`)
})

await step('③ 调用方 system 必须被注入到 messages 的首条 user 消息', async () => {
  const CALLER = '调用方的系统提示词：你是一个严谨的工程师。'
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '帮我看看这段代码' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好' }] },
  ]
  const out = withCaller(messages, CALLER)
  assert.equal(out.length, messages.length, '不得新增消息（只能改 content）')
  const first = out[0]
  assert.ok(Array.isArray(first.content), '首条 user 的 content 应变成块数组')
  const texts = first.content.map((b) => b.text).filter((t) => typeof t === 'string')
  assert.ok(texts.includes(CALLER),
    `调用方 system 必须落进首条 user 的 content。实得文本块: ${JSON.stringify(texts)}`)
  // 原有内容不得被丢掉
  assert.ok(texts.includes('帮我看看这段代码'), '原有的用户内容不得丢失')
})

await step('④ 幂等：同一条消息重复注入不叠加（只看落点那条，不全局找）', async () => {
  const CALLER = 'CALLER_SYSTEM'
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  const once = withCaller(messages, CALLER)
  const twice = withCaller(once, CALLER)
  const count = (msgs) => msgs[0].content.filter((b) => b.text === CALLER).length
  assert.equal(count(once), 1, '首次注入应只出现 1 次')
  assert.equal(count(twice), 1, `重复注入不得叠加（否则多轮里会重复计入），实得 ${count(twice)} 次`)
})

await step('⑤ 空 / 未定义的调用方 system 不改变 messages', async () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  for (const empty of [undefined, '', '   ']) {
    const out = withCaller(messages, empty)
    assert.deepEqual(out, messages, `空 caller（${JSON.stringify(empty)}）不得改动 messages`)
  }
})

if (failed > 0) { console.error(`\nchannel-zcode-system-blocks: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-zcode-system-blocks: 全部通过')
