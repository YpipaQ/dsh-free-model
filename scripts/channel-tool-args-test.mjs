/**
 * 工具参数三分类（`ok` / `truncated` / `invalid`）的回归钉子
 * （gitee IKQ8Y1，2026-10-25 上游修复；本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-tool-args-test.mjs
 *
 * ## 钉住什么
 *
 * 1. **三分类语义**：「流被掐断（参数不完整）」与「模型把参数写坏（结构完整但
 *    JSON 非法）」必须分开 —— 前者该**重试**，后者**不可重试**。
 * 2. 旧实现的缺陷：`invalid` 也报 `max-tokens`，而 DSH 客户端对该码只有固定
 *    i18n「已达到输出 token 上限」、**不读适配器 message** ⇒ 病因被吞、
 *    用户被引向「额度用满」（实测受害轮次 outputTokens=2516 / 上限 128000）。
 * 3. `TOOL_ARGS_INVALID` 必须**不可重试**（不在 harness 的
 *    `DEFAULT_RETRYABLE_CODES` 里），且文案说清「不是 token 上限也不是网络中断」。
 * 4. `isUsableToolArguments` 与 `classifyToolArguments === 'ok'` **不是**一回事：
 *    `ok` 包含 JSON 标量（`123`/`null`/`[1,2]`），而那些**不是可执行参数**。
 * 5. 两个接入点（`sse.ts` 的判据 / `buddy-adapter` 与 `openai-compat` 的出口）
 *    必须都在。
 *
 * ## 输入 / 输出
 *
 * - 输入：`vendor/channel-pack/src/sse.ts`（纯函数源码）、两个接入点源码。
 * - 输出：6 条断言；全过打印 `channel-tool-args: 全部通过`。
 * - 边界：纯本地、不发网络。行为验证用**等价内联实现**跑真值表（源码级断言
 *   钉「语句在不在」，真值表钉「语义对不对」）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const sseSrc = read('vendor/channel-pack/src/sse.ts')
const buddySrc = read('vendor/channel-pack/src/buddy-adapter.ts')
const compatSrc = read('vendor/channel-pack/src/openai-compat.ts')

/**
 * 与 `sse.ts` 的 `classifyToolArguments` **等价的内联实现**（用于真值表）。
 * ⚠️ 这份是**测试夹具**，不是产品代码 —— 源码若改了语义，下面的断言①会先红。
 */
const COMPLETE_INVALID_LITERAL_RE = /^(?:NaN|-?Infinity|undefined)$/
const INVISIBLE_FORMAT_RE = /[\p{Cf}]/gu
function classifyFixture(raw) {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return 'ok'
  try { JSON.parse(trimmed); return 'ok' } catch { /* 继续判 */ }
  if (COMPLETE_INVALID_LITERAL_RE.test(trimmed)) return 'invalid'
  const visible = trimmed.replace(INVISIBLE_FORMAT_RE, '')
  if (visible !== trimmed) { try { JSON.parse(visible); return 'truncated' } catch { /* 继续 */ } }
  const last = trimmed[trimmed.length - 1]
  if (last !== '}' && last !== ']') return 'truncated'
  let braces = 0, brackets = 0, inString = false, escaped = false
  for (const ch of trimmed) {
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') braces += 1
    else if (ch === '}') { braces -= 1; if (braces < 0) return 'truncated' }
    else if (ch === '[') brackets += 1
    else if (ch === ']') { brackets -= 1; if (brackets < 0) return 'truncated' }
  }
  if (braces !== 0 || brackets !== 0) return 'truncated'
  if (inString) return 'truncated'
  return 'invalid'
}
function isUsableFixture(raw) {
  if (raw.trim().length === 0) return true
  let parsed
  try { parsed = JSON.parse(raw) } catch { return false }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  return true
}

/**
 * 从源码里抠出某个具名函数的完整定义（按花括号配对）。
 */
function extractFunction(source, name) {
  const sig = new RegExp(`(?:export )?function ${name}\\(`, 'g')
  const m = sig.exec(source)
  if (!m) return undefined
  const start = m.index
  // ⚠️⚠️ 不能只按花括号配对：函数体里**字符串**含 `}`（如 `if (last !== '}')`）
  // 会让配对提前结束（2026-11-02 实测：截断在字符串中间 ⇒ 生成的 JS 非法）。
  // ⇒ 必须跟踪字符串 / 注释状态。
  let i = source.indexOf('{', start)
  let depth = 0
  let inString = false
  let quote = ''
  let inLineComment = false
  let inBlockComment = false
  for (; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++ } continue }
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === quote) { inString = false }
      continue
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inString = true; quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  return undefined
}


/**
 * 把抠出来的 `classifyToolArguments` 函数体变成**可执行的** JS。
 *
 * 剥掉 TS 类型注解（`: ToolArgumentsClass`、`: string`），并补上它引用的两个常量
 * 与类型别名。⚠️ 这是把「测夹具」换成「测产品代码」的关键一步。
 */
function buildLiveClassifier(fnSource) {
  // 只剥**签名**里的类型注解（函数体内的行不含类型，已核实）
  const js = fnSource
    .replace(/export function/g, 'function')
    .replace(/\(raw: string\): ToolArgumentsClass/, '(raw)')
  const prelude = 'const COMPLETE_INVALID_LITERAL_RE = /^(?:NaN|-?Infinity|undefined)$/;'
    + 'const INVISIBLE_FORMAT_RE = /[\\p{Cf}]/gu;'
  // eslint-disable-next-line no-new-func
  return new Function(prelude + '\n' + js + '\nreturn classifyToolArguments;')()
}


let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① sse.ts 导出三分类与四个配套函数', async () => {
  for (const sig of [
    'export function classifyToolArguments(',
    "export type ToolArgumentsClass = 'ok' | 'truncated' | 'invalid'",
    'export function isUsableToolArguments(',
    'export function toolArgsInvalidIsSoleOutput(',
    'export function toolArgsInvalidBlocks(',
    'export function toolArgsInvalidFailure(',
    'export const TOOL_ARGS_INVALID_CODE',
  ]) {
    assert.ok(sseSrc.includes(sig), `sse.ts 应含 ${sig}`)
  }
})

await step('② 真值表：掐断 → truncated、写坏 → invalid', async () => {
  const cases = [
    ['{"a":1}', 'ok', '合法 JSON'],
    ['', 'ok', '空串（无参工具的合法形态）'],
    ['{"path":"a.tx', 'truncated', '缺右括号（被掐断）'],
    ['{"a":1,}', 'invalid', '多余逗号（结构完整但非法）'],
    ['NaN', 'invalid', '完整非法字面量'],
    ['\u200b{"a":1}', 'truncated', '零宽字符污染（模型写对了，错在不可见字符）'],
    ['},"b":2}', 'truncated', '深度转负（分片丢失）'],
    ['[1,2,3]', 'ok', '合法数组'],
  ]
  for (const [input, want, why] of cases) {
    assert.equal(classifyFixture(input), want, `${why}: ${JSON.stringify(input)}`)
  }
})

await step('②b 夹具必须与源码真实语义挂钩（防「测的是夹具、源码坏了仍绿」）', async () => {
  // ⚠️⚠️ 2026-11-02 变异实测抓到的**假绿**：真值表跑的是本文件内联的夹具，
  // 而源码把 `invalid` 分支改成 `truncated` 后，真值表**照样全绿** ⇒ 套件与产品
  // 代码脱钩。修法：把源码里 `classifyToolArguments` 的函数体抠出来、用
  // `new Function` 真跑一遍真值表。这样源码语义一改，这里立刻红。
  const body = extractFunction(sseSrc, 'classifyToolArguments')
  assert.ok(body, '应能从源码抠出 classifyToolArguments')
  const live = buildLiveClassifier(body)
  const cases = [
    ['{"a":1}', 'ok'], ['', 'ok'], ['{"path":"a.tx', 'truncated'],
    ['{"a":1,}', 'invalid'], ['NaN', 'invalid'], ['\u200b{"a":1}', 'truncated'],
    ['},"b":2}', 'truncated'],
  ]
  for (const [input, want] of cases) {
    assert.equal(live(input), want, `源码实跑 ${JSON.stringify(input)}`)
  }
})

await step('③ ok ≠ 可用：标量/数组不是可执行参数', async () => {
  // ⚠️ 上游对抗审计实测的真缺陷：拿 `=== 'ok'` 判「另一个可用调用」会漏判
  for (const [input, want] of [['123', false], ['"abc"', false], ['null', false],
    ['true', false], ['[1,2]', false], ['{}', true], ['{"a":1}', true], ['', true]]) {
    assert.equal(isUsableFixture(input), want, `isUsableToolArguments(${JSON.stringify(input)})`)
  }
})

await step('④ TOOL_ARGS_INVALID 不可重试 + 文案要说清不是 token 上限', async () => {
  const seg = sseSrc.slice(sseSrc.indexOf('export function toolArgsInvalidFailure'))
  assert.match(seg, /这不是输出 token 上限，也不是网络中断/,
    '文案必须说清病因（否则用户仍按旧 i18n 去查额度）')
  // 不可重试：码名不得取 harness 可重试集合里的那些
  const codeLine = sseSrc.match(/export const TOOL_ARGS_INVALID_CODE = '(\w+)'/)
  assert.ok(codeLine, '应定义错误码')
  const code = codeLine[1]
  for (const retryable of ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH', 'QUOTA', 'ACCOUNT_QUOTA', 'max-tokens']) {
    assert.notEqual(code, retryable, `错误码不得取 ${retryable}（会被 UI 替换文案或走无谓重试）`)
  }
})

await step('⑤ 两个接入点都在，且坏参数排在 max-tokens 之前', async () => {
  for (const [name, src] of [['buddy-adapter', buddySrc], ['openai-compat', compatSrc]]) {
    assert.ok(src.includes('toolArgsInvalidIsSoleOutput('), `${name} 应调用 toolArgsInvalidIsSoleOutput`)
    // 顺序：toolArgsInvalid 分支必须在 `finishReason === 'length'` 之前
    const invalidAt = src.indexOf('toolArgsInvalidIsSoleOutput(')
    const lengthAt = src.indexOf("finishReason === 'length'")
    assert.ok(invalidAt > 0 && lengthAt > 0, `${name} 应同时有两者`)
    assert.ok(invalidAt < lengthAt,
      `${name}: 坏参数判据必须排在 max-tokens 之前（否则永远轮不到它）`)
  }
})

await step('⑥ 接入点只收名字可用的块（无名块本来就会被丢弃）', async () => {
  for (const [name, src] of [['buddy-adapter', buddySrc], ['openai-compat', compatSrc]]) {
    const seg = src.slice(src.indexOf('invalidArgEntries'), src.indexOf('invalidArgEntries') + 600)
    assert.match(seg, /hasUsableToolName\(block\.name\)/, `${name} 应过滤掉无名块`)
    assert.match(seg, /classifyToolArguments\(block\.text\)/, `${name} 应用三分类判据`)
  }
})

if (failed > 0) { console.error(`\nchannel-tool-args: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-tool-args: 全部通过')
