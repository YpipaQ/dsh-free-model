/**
 * TRAE 多 tool_call 时**工具结果图片的顺序**回归钉子
 * （上游 0cb0140a，本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-trae-image-order-test.mjs
 *
 * ## 钉住的缺陷（严重：会话永久损坏）
 *
 * DSH 0.1.7 起工具结果是**一等 `role:'tool'` 消息**。旧实现在**每条消息**处理末尾
 * 都无条件 `flushToolImages()` ⇒ 当一条 assistant 发出 **≥2 个 tool_call**、且
 * **非最后一个**工具结果内嵌图片时，图片会在「第一条工具结果」那条消息末尾就被
 * flush 成 user 消息，**插到下一条 `role:'tool'` 之前**：
 *
 *     assistant(tool_calls) -> user(图片) -> tool -> tool   ← 违反上游配对约束
 *
 * 上游恒定回 `code=4027 Messages with role 'tool' must be a response to a
 * preceding message with 'tool_calls'`，且**坏报文已被持久化、每次请求原样重放**
 * ⇒ 该会话**永久无法对话**。既有用例只覆盖 1 个 tool_call，故这条路径从未被测到。
 *
 * ## 为什么直接测序列化函数（而不是走 stream）
 *
 * `stream()` 前面有一道**模型能力门**（图片能力来自远端 `display_config.multimodal`），
 * 离线桩里造不出「该模型收图」的条件 ⇒ 会在序列化之前就被拦下。
 * 而缺陷**本体就在序列化层**（图片插到哪条消息之间），故直接测它最直接。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `serializeTraeMessagesForTest`（测试专用包装）。
 * - 输出：4 条断言；全过打印 `channel-trae-image-order: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-trae-img-'))
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
const serialize = pack.serializeTraeMessagesForTest
assert.equal(typeof serialize, 'function',
  'pack.js 必须导出 serializeTraeMessagesForTest（测试专用包装）')

/** 1 条 assistant 发 2 个 tool_call；**第一个**工具结果带内嵌图片（非最后一个）。 */
const IMAGE_URLS = new Map([['img-1', 'data:image/png;base64,AAAA']])
const history = [
  { role: 'user', content: [{ type: 'text', text: '看这两张图' }] },
  {
    role: 'assistant',
    content: [
      { type: 'tool-call', id: 'call_a', name: 'read', arguments: '{"path":"a.png"}' },
      { type: 'tool-call', id: 'call_b', name: 'read', arguments: '{"path":"b.png"}' },
    ],
  },
  // ⚠️⚠️ **触发形态是「跨消息」**（本套件前两版都构造错了，变异验证时全绿才发现）：
  //
  // 缺陷是「**每条消息处理末尾**都无条件 flush」。若两个 tool-result 放在**同一条**
  // user 消息里，flush 发生在「两条 tool 都 push 完之后」⇒ 顺序反而正确、缺陷不触发。
  // 必须让它们**各占一条消息**：处理完第一条消息（含带图的 tool-result A）末尾就
  // 把图片 flush 成 user 消息 ⇒ 下一条 tool-result B 的 tool 才 push ⇒
  //
  //     assistant(tool_calls) -> tool(A) -> user(图片) -> tool(B)   ← 4027
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_a', content: [{ type: 'image', attachment: { attachmentId: 'img-1' } }] }] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_b', content: [{ type: 'text', text: 'done' }] }] },
  { role: 'user', content: [{ type: 'text', text: '继续' }] },
]

const wire = serialize(history, IMAGE_URLS)
const roleSeq = wire.map((m) => m.role)
const isImageMsg = (m) => m.role === 'user' && Array.isArray(m.content)
  && m.content.some((p) => p?.type === 'image_url')

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 两条 tool 消息必须**相邻**（中间不得夹 user 图片）', async () => {
  const toolIdx = wire.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0)
  assert.ok(toolIdx.length >= 2, `应有 ≥2 条 tool 消息（实得 ${toolIdx.length}）。序列: ${roleSeq.join(' -> ')}`)
  for (let k = 1; k < toolIdx.length; k++) {
    assert.equal(toolIdx[k] - toolIdx[k - 1], 1,
      `第 ${k} 条 tool 与上一条之间夹了 ${toolIdx[k] - toolIdx[k - 1] - 1} 条消息`
      + `（上游会回 4027：Messages with role 'tool' must be a response to a preceding `
      + `message with 'tool_calls'）。实际序列: ${roleSeq.join(' -> ')}`)
  }
})

await step('② 图片仍必须被发出（不许为了修顺序把图静默丢弃）', async () => {
  const imageMsgs = wire.filter(isImageMsg)
  assert.ok(imageMsgs.length > 0,
    `工具结果里内嵌的图片必须仍被发出。实际序列: ${roleSeq.join(' -> ')}`)
})

await step('③ 图片消息必须在**全部 tool 消息之后**', async () => {
  const lastTool = wire.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0).pop()
  assert.ok(lastTool !== undefined, '应有 tool 消息')
  const imageAt = wire.findIndex(isImageMsg)
  assert.ok(imageAt > lastTool,
    `图片必须排在最后一条 tool 之后（图片在 ${imageAt}、最后 tool 在 ${lastTool}）。`
    + `实际序列: ${roleSeq.join(' -> ')}`)
})

await step('④ 源码级：循环体内不得有**无条件** flush（防回归）', async () => {
  const src = fs.readFileSync(new URL('../vendor/channel-pack/src/trae-adapter.ts', import.meta.url), 'utf8')
  const loopStart = src.indexOf('for (const message of normalized)')
  const loopEnd = src.indexOf('return wire', loopStart)
  assert.ok(loopStart > 0 && loopEnd > loopStart, '应能找到序列化循环')
  const body = src.slice(loopStart, loopEnd)
  // ⚠️ 判据：循环体**末尾**（紧邻 return wire 之前）不得是无条件 flush。
  // 正确形态：`}\n  flushToolImages()\n  return wire` —— flush 在循环**之后**。
  const tail = src.slice(loopEnd - 600, loopEnd)
  // 形态：`}`（循环结束）→ 可有注释 → `flushToolImages()` → `return wire`
  // ⚠️ 用 `indexOf` + 位置比较，不用跨多行的正则：注释里含反引号与中文标点，
  // 正则容易被它们绊住（本断言第一版就栽在这）。判据是**顺序**：
  // 循环的收尾 `}` 之前不出现 flush，而 `}` 之后、`return wire` 之前要出现一次。
  const braceAt = tail.lastIndexOf('\n  }')
  const flushAt = tail.lastIndexOf('flushToolImages()')
  assert.ok(braceAt >= 0, '应能找到循环收尾的 `}`')
  assert.ok(flushAt > braceAt,
    `最后那次 flush 必须在循环收尾 \`}\` **之后**（否则就是每条消息末尾都无条件 flush，`
    + `正是把图片插到两条 tool 之间的成因）。braceAt=${braceAt} flushAt=${flushAt}`)
  // 且循环体内最后一处 flush 前必须是 `}`（说明它在循环外）
  const inLoopFlush = body.lastIndexOf('flushToolImages()')
  assert.ok(inLoopFlush > 0, '循环体内应有 flush（assistant 分支前那处）')
  // assistant 分支开头必须 flush（上一批 tool 已全部下发，此处落地安全）
  const assistantSeg = body.slice(body.indexOf("if (message.role === 'assistant')"))
  assert.match(assistantSeg.slice(0, 500), /flushToolImages\(\)/,
    'assistant 分支开头应有 flush')
})

if (failed > 0) { console.error(`\nchannel-trae-image-order: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-trae-image-order: 全部通过')
