/**
 * 额度耗尽（14018 / Credits exhausted）判据的回归钉子
 * （gitee IKQ6HJ，2026-10-25 上游修复；本 fork 2026-10-29 移植）。
 *
 *     node scripts/channel-credit-exhausted-test.mjs
 *
 * ## 钉住什么
 *
 * 1. **码值腿**认**嵌套**形态 `{"error":{"data":{"code":14018}}}`（buddy 系真实报文，
 *    码在第二层）—— 只看顶层会让这条腿恒不命中。
 * 2. **文案腿**认 `Credits exhausted` / 中文「积分不足」等确定性组合。
 * 3. **不误伤**：`the context window is insufficient for this model` 必须**不**被
 *    判成额度耗尽（那是「换号无益」的另一类失败）。
 * 4. **冷却终点是 UTC+8 当日 24:00**，不是 +24h（滑动 24h 会让 23:50 烧光的账号
 *    被封到次日 23:50，用户白等近一整天）。
 * 5. **`explicitRateResetAtMs` 必须同时支持 JSON 与压平文本** —— 探测腿拿到的是
 *    适配器压平后的 `LlmError.message`，只解析 JSON 会恒 `undefined` ⇒ 两条腿算出
 *    两个解禁时刻（用户点「重测」看到时间跳变）。
 *
 * ## 输入 / 输出
 *
 * - 输入：`vendor/channel-pack/pack.js`（构建产物，函数名可能被 esbuild 改名，
 *   故按**行为**验证：用 `import` 源码不可行时从产物抠；本套件直接读源码文本
 *   做**源码级**断言 + 用 `node --experimental-strip-types` 不可用，改用正则抠函数体）。
 * - 输出：5 条断言；全过打印 `channel-credit-exhausted: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const srcPath = path.join(root, 'vendor', 'channel-pack', 'src', 'llm-adapter.ts')
const src = fs.readFileSync(srcPath, 'utf8')

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 三个导出存在', async () => {
  for (const name of ['isCreditExhausted', 'creditExhaustedResetAtMs', 'explicitRateResetAtMs']) {
    assert.match(src, new RegExp(`export function ${name}\\(`), `应导出 ${name}`)
  }
  assert.match(src, /export const CREDIT_EXHAUSTED_BUSINESS_CODE = 14018/, '应导出额度耗尽码常量')
})

await step('② 码值腿必须认嵌套形态（buddy 真实报文码在第二层）', async () => {
  assert.match(src, /const nested = typeof inner\?\.data === 'object'/, '应解析 inner.data 嵌套层')
  const seg = src.slice(src.indexOf('export function isCreditExhausted'),
    src.indexOf('export function creditExhaustedResetAtMs'))
  assert.match(seg, /nested\?\.code/, '码值候选应包含嵌套层 code')
  assert.match(seg, /CREDIT_EXHAUSTED_PATTERN\.test\(body\)/, '应有文案腿兜底')
})

await step('③ 文案腿窄：不得收 insufficient 这类泛词', async () => {
  const patSeg = src.match(/const CREDIT_EXHAUSTED_PATTERN =\n\s*(\/.+?\/i)/)
  assert.ok(patSeg, '应能取到文案判据正则')
  const pattern = patSeg[1]
  assert.doesNotMatch(pattern, /insufficient/i,
    '文案判据**不得**收 insufficient（会误伤「上下文不足」那类换号无益的失败）')
  assert.match(pattern, /credits\?\\s\+exhausted/i, '应认 Credits exhausted 完整短语')
  assert.match(pattern, /积分/, '中文侧应认积分')
})

await step('④ 冷却终点复用 UTC+8 当日 24:00（不是 +24h）', async () => {
  const seg = src.slice(src.indexOf('export function creditExhaustedResetAtMs'),
    src.indexOf('export function explicitRateResetAtMs'))
  assert.match(seg, /nextUtc8DayStartMs\(nowMs\)/,
    '额度耗尽终点必须是 nextUtc8DayStartMs（与 loomy/qoder/zcode/codearts 同口径）')
  assert.doesNotMatch(seg, /nowMs \+ 86_?400_?000|24 \* 60 \* 60 \* 1000/,
    '不得写成滑动 +24h')
})

await step('⑤ explicitRateResetAtMs 必须同时支持 JSON 与压平文本', async () => {
  const seg = src.slice(src.indexOf('export function explicitRateResetAtMs'))
  assert.match(seg, /catch \{[\s\S]{0,600}?RESET_TIME_PATTERN\.exec\(body\)/,
    '非 JSON 分支必须裸扫整段文本（否则探测腿恒 undefined ⇒ 两腿算出两个时刻）')
})

await step('⑥ 两条腿（推理 / 探测）的额度耗尽表达式必须逐字同形', async () => {
  // 上游对抗审计实测的真缺陷：两条腿写不同表达式 ⇒ 同一条报文算出两个解禁时刻
  // ⇒ 用户点一次「重测」就看到击杀时间跳变（实测 2099 vs 次日）。
  // ⚠️⚠️ **必须先剥掉注释行**（2026-10-29 变异实测抓到的假绿）：
  // `account-probe.ts` 的**注释里**也写着同一个表达式作为说明文字，
  // 不剥注释时把真代码改掉仍能匹配到注释 ⇒ 钉子无牙。
  const stripComments = (text) => text.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const probeSrc = stripComments(fs.readFileSync(path.join(root, 'vendor', 'channel-pack', 'src', 'account-probe.ts'), 'utf8'))
  const buddySrc = stripComments(fs.readFileSync(path.join(root, 'vendor', 'channel-pack', 'src', 'buddy-adapter.ts'), 'utf8'))
  const PATTERN = 'explicitRateResetAtMs\\(\\w+\\) \\?\\? creditExhaustedResetAtMs\\(\\)'
  const probeHit = probeSrc.match(new RegExp(PATTERN))
  const buddyHit = buddySrc.match(new RegExp(PATTERN))
  assert.ok(probeHit, '探测腿（account-probe.ts）必须用「显式优先 + 自然日兜底」表达式')
  assert.ok(buddyHit, '推理腿（buddy-adapter.ts）必须用同一表达式')
  // 两者调用的参数名可以不同（errorText vs message），但**结构必须一致**
  // 参数名本身可以不同（探测腿拿 `message`、推理腿拿 `errorText`）——
  // **结构**必须一致：`显式优先 ?? 自然日兜底`。故只归一化「括号里的实参名」。
  const norm = (t) => t.replace(/^(explicitRateResetAtMs)\(\w+\)/, '$1(A)')
  assert.equal(norm(probeHit[0]), norm(buddyHit[0]),
    `两条腿表达式结构不一致: 探测=${probeHit[0]} 推理=${buddyHit[0]}`)
})

if (failed > 0) { console.error(`\nchannel-credit-exhausted: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-credit-exhausted: 全部通过')
