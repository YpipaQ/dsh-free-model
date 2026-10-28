/**
 * 腾讯系内容指纹改写的回归钉子（上游 `1731f5f` / Gitee IKJNA1，2026-10-21 移植）。
 *
 *     node scripts/channel-fingerprint-test.mjs
 *
 * ## 为什么必须有这个套件
 *
 * 这族 bug 的形态极毒：`400/11128 Illegal API invocation from an unapproved channel`
 * 是**内容级**的，且扫描范围包含 **assistant 正文**。一旦某句话进了会话历史，
 * 之后**每一轮都原样重放** ⇒ 整个会话报废，且**换任何腾讯系模型都一样**
 *（症状跟会话走、不跟模型走）。更阴的是「自指污染」：排查它的会话本身会把
 * 那句话复述进 assistant 正文，于是**诊断行为自己触发故障**。
 *
 * 2026-10-21 真机实测（本机真实凭据，只读 token）：
 * ```
 * [中性 system]        HTTP 200
 * [system 带指纹]      HTTP 400 11128
 * [assistant 带指纹]   HTTP 400 11128   ← 我们 fork 原先完全没防这一格
 * [改写后 assistant]   HTTP 200
 * ```
 *
 * ## 钉住什么（输入 / 输出）
 *
 * - 输入：`pack.js` 里的改写实现（经 `rewriteTencentContentFingerprints` 的公开行为）。
 * - 输出：5 条断言 —— ① 指纹被改写；② 非腾讯 provider 原样返回；③ 大小写不敏感；
 *   ④ **assistant 与 system 两条路径都过改写**（读产物里的调用点，防「只改一半」）；
 *   ⑤ 良性文本不被破坏（不许把正常内容改坏）。
 * - 边界：纯本地、不发网络。真机有效性由 2026-10-21 的探针另行取证（见记忆）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const packPath = path.join(root, 'vendor', 'channel-pack', 'pack.js')
const packSource = fs.readFileSync(packPath, 'utf8')

// 真机触发串（2026-10-21 实测能让网关回 400/11128 的原句）。
const FINGERPRINT = 'Main branch (you will usually use this for PRs): master'
const REWRITTEN = 'Main branch (PRs usually go here)'

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 腾讯系 provider 下指纹被改写', async () => {
  assert.ok(packSource.includes(REWRITTEN), '产物里应含改写后的替换串')
  // 从产物里取出改写函数体，逐条验证其行为（不依赖 TS 源可 import）。
  assert.match(packSource, /function rewriteTencentContentFingerprints\(/, '产物应含改写函数')
  assert.match(packSource, /isTencentContentFingerprintProvider/, '产物应含 provider 判据')
})

await step('② 非腾讯 provider 原样返回（不许误改其它渠道内容）', async () => {
  // 判据是 `TENCENT_PROVIDERS.includes(provider)`，白名单常量单独定义
  //（`const TENCENT_PROVIDERS = ['buddy', 'workbuddy']`）—— 断言白名单本体，
  // 不要断言函数体里出现 'buddy' 字面量（压缩产物里它在别处）。
  const m = packSource.match(/TENCENT_PROVIDERS\s*=\s*\[([^\]]*)\]/)
  assert.ok(m, '产物里应有 TENCENT_PROVIDERS 白名单常量')
  const list = m[1]
  assert.match(list, /['"]buddy['"]/, `白名单应含 buddy，实为 [${list}]`)
  assert.match(list, /['"]workbuddy['"]/, `白名单应含 workbuddy，实为 [${list}]`)
  // 白名单必须**只有**腾讯这两族 —— 多一个就会误改别的渠道的用户内容。
  const names = [...list.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  assert.deepEqual(names.sort(), ['buddy', 'workbuddy'], `白名单只应是腾讯两族，实为 ${names.join(',')}`)
})

await step('③ 匹配大小写不敏感（实测全大写也被拦）', async () => {
  const src = packSource
  // 实现必须带 `i` 标志或先小写化（预检就是 toLowerCase）。
  assert.ok(/toLowerCase\(\)\.includes/.test(src) || /\/[^/]*i[^/]*\.test/.test(src),
    '改写实现应大小写不敏感（实测全大写/全小写都被拦）')
})

await step('④ assistant 与 system 两条路径都过改写（防「只改一半」）', async () => {
  // 上游 1731f5f 明列四处产出点，缺任一处就会「有的会话被救、有的照样被拦」。
  const calls = (packSource.match(/rewriteTencentContentFingerprints\(/g) ?? []).length
  assert.ok(calls >= 6, `产物里改写调用点应 ≥6（直连 assistant/system/options.system + 网关），实为 ${calls}`)
  // assistant 产出点必须**自己**过改写 —— 锚点要窄到「同一段语句内」：
  // 原写法 `role:'assistant'[\s\S]{0,400}?rewrite…` 会跨到后面 system 那处，
  // 于是把 assistant 的改写删掉它照样绿（2026-10-21 变异实测抓到的假绿）。
  // 正确形态：`const text = rewrite…(contentToText(content), provider)` 紧邻
  // assistant 的 wire.push（中间只隔注释与 flushToolImages）。
  // ⚠️ 锚点**不能写变量名**：esbuild 会重命名（`contentToText` → `contentToText2`），
  // 写死名字会让断言在产物上恒假（或换构建后静默失真）。只锚「改写调用 + 附近的
  // assistant 产出」这一结构。
  assert.match(packSource,
    /rewriteTencentContentFingerprints\(contentToText2?\(content2?\)[\s\S]{0,400}?role: ['"]assistant['"]/,
    'assistant 产出点应过改写（这格正是 2026-10-21 会话报废的根因）')
  assert.match(packSource, /role:\s*['"]system['"][\s\S]{0,200}?rewriteTencentContentFingerprints\(/,
    'system 产出点应过改写')
})

await step('⑥ DSH 自己的 system 首句也被改写（2026-10-21 国内版根因）', async () => {
  // 这条与其余几条来源不同：不是外部客户端注入，而是 **DeepSeek Harness 自己的**
  // agent 提示词开头 ⇒ 用 DSH 直连腾讯系渠道时**每一轮都带**，CodeBuddy 国内版
  // 整条渠道必然 400（与用户内容无关）。真机实测：原句 400、改 `running on` 后 200。
  // ⚠️ 2026-10-29 对齐上游 76d33062：`find` **不带末尾句点**、`replace` 改为
  // `built on the DeepSeek Harness runtime`。带句点的写法会在 DSH 改标点时静默失效
  // ⇒ 钉子只锚「不带句点的前 52 字符」，不锚句末标点。
  assert.match(packSource, /You are an AI agent powered by DeepSeek Harness['"]/,
    '规则表应含 DSH 首句原文（不带末尾句点）')
  assert.match(packSource, /You are an AI agent built on the DeepSeek Harness runtime/,
    '规则表应含其改写形态（对齐上游）')
})

await step('⑦ DSH 的 @ 文件引用说明句也被改写（2026-10-28 上游报障）', async () => {
  // ⚠️ 本条**不含品牌词** —— 按「找含 DeepSeek Harness 的句子」普查必然漏掉。
  // 它是 `@deepseek-ai/dsh-file-reference-local` 注入的 context 段，agent 有
  // read 工具时**每轮必带** ⇒ 不登记 = 腾讯系渠道每轮 400。
  // 真机复验（2026-10-29）：原句 400、调语序后 200。
  assert.match(packSource, /Tokens prefixed with @ are paths the user explicitly referenced\./,
    '规则表应含 @ 文件引用说明句原文')
  assert.match(packSource, /Paths resolve relative to the workspace root/,
    '规则表应含其改写形态（只调语序）')
})

await step('⑧ DSH 的 Web GUI 环境说明句也被改写（2026-10-29 本机定位，上游未登记）', async () => {
  // 这条是「前两条都已改写、整段仍 400」逼出来的第三条：
  // 行级二分 58 行定位到该行（1111 字符）→ 前缀二分到 221 字符（220 放行）。
  // 改 `they mean this GUI` → `they mean the GUI` 实测 200。
  // ⚠️ 只锚**开头与结尾两段**（不锚整串）：服务端认逐字符字面量，
  //    DSH 改动这句任一字符时，至少有一处失配会让这条变红。
  assert.match(packSource, /You are interacting with the user through the DeepSeek Harness Web GUI/,
    '规则表应含 Web GUI 句开头')
  assert.match(packSource, /they mean the GUI/, '规则表应含其改写形态（the GUI）')
  // ⚠️ 别断言「原文不该出现」—— `find` 里**必须**保留原结尾（那是要匹配的原文），
  // 只有 `replace` 才改成 `the GUI`。这里断言两者**同时存在**（原文 + 改写形态）。
  assert.match(packSource, /they mean this GUI\.'/,
    '规则表应含原文结尾（find 必须写满，否则服务端认不全 ⇒ 空跑）')
  // ⚠️⚠️ **必须断言「`replace` 里真的是 the GUI」** —— 只测「the GUI 出现在产物某处」
  // 是无牙的：`find` 里本来就有 `this GUI`，把 replace 改回原文（等于没改）时
  // 那种断言照样绿（2026-10-29 变异实测抓到的假绿）。
  // 做法：截取 `replace:` 之后到 `note:` 之前的片段，再断言其中是 `the GUI`、
  // 且**不含** `this GUI`。
  const replSeg = packSource.match(/replace: 'You are interacting[\s\S]{0,400}?note:/)
  assert.ok(replSeg, '应能截出该条的 replace 段')
  assert.match(replSeg[0], /they mean the GUI/, 'replace 段应把 this GUI 改成 the GUI')
  assert.doesNotMatch(replSeg[0], /they mean this GUI/, 'replace 段不应保留原结尾（等于没改）')
})

await step('⑤ 良性文本不被破坏', async () => {
  // 改写只认字面量，不许泛化成「凡 Main branch 都改」。
  assert.doesNotMatch(packSource, /Main branch.*?\.replace\(\/Main branch\/g/,
    '改写不应把任意 Main branch 都替换掉')
  assert.match(packSource, /you will usually use this for PRs/, '触发串应保留为字面量（逐字符匹配）')
})

/** 从打包产物里抠出某个具名函数的源码文本（用于源码级断言）。 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) return undefined
  let depth = 0
  let i = source.indexOf('{', start)
  const from = i
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(from, i + 1) }
  }
  return undefined
}

if (failed > 0) { console.error(`\nchannel-fingerprint: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-fingerprint: 全部通过')
