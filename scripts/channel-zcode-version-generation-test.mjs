/**
 * ZCode「版本 × 身份块必须同代」的回归钉子
 * （上游 e541c582 / Issue #45，本 fork 2026-11-09 移植）。
 *
 *     node scripts/channel-zcode-version-generation-test.mjs
 *
 * ## 钉住的缺陷（整条渠道全量不可用）
 *
 * 上游把「客户端版本号」与「system 身份块文本」当**同一代**校验，**跨代即**
 * `405 + {"code":3012,"msg":"request has been blocked due to unusual activity."}`
 *（与账号 / IP / 频率 / 其余头都无关）。
 *
 * 真机 2×2（同 URL、同 18 个头、同 body 形状，只改这两个变量，8 发）：
 *
 * | `X-ZCode-App-Version` | 身份块 | 结果 |
 * |---|---|---|
 * | `3.16.3` | 3.16 文本 | **200** ×3 |
 * | `3.17.2` | 3.16 文本 | **405 + 3012** ×2 |
 * | `3.16.3` | 3.17 文本 | **405 + 3012** ×3 |
 * | `3.17.1` / `3.17.2` | 3.17 文本 | **200** ×2 |
 *
 * ## 为什么「升级后必现」
 *
 * 官方客户端 11-02 升级到 3.17.2 后，**凭据里的 `app_version` 也变新** ⇒ 插件发
 * 「新版本 + 旧身份块」⇒ 跨代 ⇒ 报障者「从未成功过一次」。故本仓库把身份块换成
 * 3.17 代、版本门槛同步抬到 `3.17.1`。
 *
 * ## ⚠️ 本项**无号可测**，只做「同代」一致性断言
 *
 * 判据来自上游真机 2×2（结论是「两值必须同代」这类协议不变式），本套件钉的是
 * **仓库内部两处不漂移**：身份块是 3.17 代 ⇔ 版本门槛是 3.17.x。任一处单独改动
 * 都会让另一处失配 ⇒ **全量用户 3012**。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `ZCODE_INFERENCE_MIN_APP_VERSION` /
 *   `zcodeInferenceAppVersion` / `buildZcodeSystemBlocks`。
 * - 输出：5 条断言；全过打印 `channel-zcode-version-generation: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-zcode-ver-'))
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
const { ZCODE_INFERENCE_MIN_APP_VERSION: MIN, zcodeInferenceAppVersion: gated, buildZcodeSystemBlocks: blocksOf } = pack
assert.equal(typeof MIN, 'string', 'pack.js 必须导出 ZCODE_INFERENCE_MIN_APP_VERSION')
assert.equal(typeof gated, 'function', 'pack.js 必须导出 zcodeInferenceAppVersion')
assert.equal(typeof blocksOf, 'function', 'pack.js 必须导出 buildZcodeSystemBlocks')

/** 读取身份块文本（两代的首句不同，是最可靠的同代指纹）。 */
const identityText = () => {
  const src = fs.readFileSync(
    new URL('../vendor/channel-pack/src/zcode-identity.ts', import.meta.url), 'utf8')
  return src
}

/** 版本门槛的主/次版本。 */
const [minMajor, minMinor] = MIN.split('.').map(Number)

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 版本门槛 = 3.17.x（与 3.17 代身份块配对）', async () => {
  assert.equal(minMajor, 3, `门槛主版本应为 3，实得 ${MIN}`)
  assert.equal(minMinor, 17,
    `⚠️ 门槛次版本应为 17（与 3.17 代身份块配对）。实得 ${MIN} —— `
    + '若身份块是 3.17 代而门槛停在 3.16，或反之，**全量用户会 3012**')
})

await step('② 身份块首句 = 3.17 代（`interactive agent`，不是 3.16 的 `interactive coding agent`）', async () => {
  const src = identityText()
  assert.match(src, /"You are ZCode, an interactive agent"/,
    '身份块首句应为 3.17 代 `You are ZCode, an interactive agent`')
  assert.doesNotMatch(src, /"You are ZCode, an interactive coding agent"/,
    '⚠️ 不得残留 3.16 代首句 `interactive coding agent` —— 与 3.17 门槛配对会**全量 3012**')
})

await step('③ ⚠️ 核心不变式：身份块代次 ⇔ 版本门槛代次（单改一处必红）', async () => {
  const src = identityText()
  const is317Identity = /"You are ZCode, an interactive agent"/.test(src)
    && !/"You are ZCode, an interactive coding agent"/.test(src)
  const is317Gate = minMajor === 3 && minMinor === 17
  assert.equal(is317Identity, is317Gate,
    `身份块与版本门槛**必须同代**（上游真机 2×2：跨代即 405+3012）。`
    + `当前身份块 3.17 代=${is317Identity}、门槛=${MIN}（3.17 代=${is317Gate}）`
    + ' —— 两者不一致就是**全量用户 3012**')
})

await step('④ 门控：旧凭据版本被抬到门槛，新版本原样保留', async () => {
  // 3.16.x 凭据（Issue #45 的报障形态）⇒ 必须被抬到 3.17.1
  assert.equal(gated({ app_version: '3.16.3' }), MIN,
    `3.16.3 凭据必须被抬到门槛 ${MIN}（否则发「新版本+旧身份块」跨代 3012）`)
  assert.equal(gated({ app_version: '3.14.3' }), MIN, '3.14.3（旧兜底值）必须被抬到门槛')
  // 更新的版本原样保留（不该被降级）
  assert.equal(gated({ app_version: '3.17.2' }), '3.17.2',
    '3.17.2 应原样保留（门控只抬不降）')
  // 缺失 / 脏值 ⇒ 用门槛
  assert.equal(gated({}), MIN, '缺 app_version 应用门槛')
  assert.equal(gated({ app_version: '' }), MIN, '空串应用门槛')
  assert.equal(gated({ app_version: '3.16.3\r\nX-Injected: 1' }), MIN,
    '含换行的脏值必须被拦下（`Headers()` 对非法头值抛 TypeError，这是安全闸）')
})

await step('⑤ 推理头**真的**走门控（不只是定义了函数）', async () => {
  const src = fs.readFileSync(
    new URL('../vendor/channel-pack/src/zcode-upstream.ts', import.meta.url), 'utf8')
  const i = src.indexOf('export function buildZcodeHeaders')
  assert.ok(i > 0, '应能找到 buildZcodeHeaders')
  const body = src.slice(i, i + 2000)
  assert.match(body, /const appVersion = zcodeInferenceAppVersion\(credential\)/,
    'buildZcodeHeaders 必须走门控（直接取 credential.app_version 会发出跨代组合）')
  assert.match(body, /'X-ZCode-App-Version': appVersion/,
    '门控结果必须真的写进 X-ZCode-App-Version')
  assert.match(body, /`ZCode\/\$\{appVersion\}`/,
    'User-Agent 必须与 X-ZCode-App-Version **同源**（两个版本号会自相矛盾）')
})

if (failed > 0) { console.error(`\nchannel-zcode-version-generation: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-zcode-version-generation: 全部通过')
