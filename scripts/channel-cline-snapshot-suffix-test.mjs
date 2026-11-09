/**
 * Cline「模型带日期/快照后缀时继承基底能力」的回归钉子
 * （上游 25e332fe / issue #18，本 fork 2026-11-09 移植）。
 *
 *     node scripts/channel-cline-snapshot-suffix-test.mjs
 *
 * ## 钉住的缺陷
 *
 * 上游常发 `qwen...-1017` / `-20241022` 这类**快照 id**，而 models.dev 只登记**基底**。
 * 原实现用完整 id 精确查表 ⇒ 查不到 ⇒ `contextWindow` / `name` / **`supportsImage`**
 * 全部丢失。
 *
 * ⚠️ 最隐蔽的是 `supportsImage` 变成「未知」⇒ 宿主据此**放行图片** ⇒ 发到不支持图的
 * 服务端（静默失败或幻觉 —— 最难排查的形态）。
 *
 * ## ⚠️⚠️ 上游对抗审计的修正：后缀**只认日历形态**
 *
 * 原正则 `-\\d{4}` 会把 `-4096` / `-1024` 这种**上下文长度数字**当快照剥掉
 * ⇒ **误继承基底的图片能力**（比不继承更糟：会把图片发给不支持图的模型）。
 * 故只认 4 位 `MMDD` 与 8 位 `YYYYMMDD`；`-2024`（只有年份）/ `-123`（3 位）/
 * `-v2` / `-1017-suffix` 都**不剥**。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `findClineModelsDevEntry` / `stripClineSnapshotSuffix`。
 * - 输出：6 条断言；全过打印 `channel-cline-snapshot-suffix: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-cline-snap-'))
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
const { findClineModelsDevEntry: find, stripClineSnapshotSuffix: strip } = pack
assert.equal(typeof find, 'function', 'pack.js 必须导出 findClineModelsDevEntry')
assert.equal(typeof strip, 'function', 'pack.js 必须导出 stripClineSnapshotSuffix')

/** models.dev 只登记**基底** id（这正是缺陷的触发条件）。 */
const DEV = new Map([
  ['qwen2.5-coder-7b-instruct', {
    name: 'Qwen2.5 Coder 7B', contextWindow: 131072, supportsImage: false,
  }],
  ['glm-4.6v', { name: 'GLM-4.6V', contextWindow: 200000, supportsImage: true }],
])

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① 精确命中优先（不剥后缀、不改名）', async () => {
  const entry = find('glm-4.6v', DEV)
  assert.ok(entry, '精确 id 应命中')
  assert.equal(entry.name, 'GLM-4.6V', '精确命中时名字不得加后缀')
  assert.equal(entry.supportsImage, true)
})

await step('② 带 `-1017` 快照后缀 ⇒ 继承基底能力（缺此则图片能力丢失）', async () => {
  const entry = find('qwen2.5-coder-7b-instruct-1017', DEV)
  assert.ok(entry,
    '带快照后缀的模型必须能查到基底条目（否则 contextWindow/supportsImage 全丢）')
  assert.equal(entry.id, 'qwen2.5-coder-7b-instruct-1017', 'id 必须是请求的那个')
  assert.equal(entry.contextWindow, 131072, '必须继承基底上下文窗口')
  assert.equal(entry.supportsImage, false, '必须继承基底图片能力')
  assert.match(entry.name ?? '', /\(1017\)$/,
    `名字应带后缀以区分不同快照（避免 UI 同名）。实得: ${entry.name}`)
})

await step('③ 带 `-20241022` 八位日期后缀 ⇒ 同样继承', async () => {
  const entry = find('glm-4.6v-20241022', DEV)
  assert.ok(entry, '8 位日期后缀也应回退到基底')
  assert.equal(entry.supportsImage, true, '应继承基地 true')
})

await step('④ ⚠️ 只认日历形态：`-4096`/`-1024` 等**上下文长度数字不得**被剥', async () => {
  // 这是上游对抗审计抓到的真缺陷：原正则 `-\d{4}` 会把尺寸当日期 ⇒
  // 误继承基底图片能力 ⇒ 把图片发给不支持图的模型（比不继承更糟）
  // `-4096` / `-8192` 这类**上下文长度**：40/81 不是合法月份 ⇒ 正确排除
  for (const id of ['qwen2.5-coder-7b-instruct-4096', 'qwen2.5-coder-7b-instruct-8192']) {
    assert.equal(strip(id), id,
      `${id} 的 4 位数字是**上下文长度**不是日期，不得剥（否则误继承图片能力）`)
    assert.equal(find(id, DEV), undefined,
      `${id} 不应匹配到基底条目（猜错会把不同模型并成一个）`)
  }
  /**
   * ⚠️ **已知残余歧义（如实登记，不假装已解决）**：`-1024` / `-1231` 这类
   * 「恰好是合法 MMDD」的 4 位数**无法与日期后缀区分** —— 1024 可以是「10 月 24 日」
   * 也可以是「1024 上下文」。上游的正则同样有这条歧义，只是它的用例没覆盖 `-1024`。
   *
   * ⇒ 本套件**不把 `-1024` 钉成「必须不剥」**（那会与上游正则冲突、也无法实现），
   *   只钉「明显非日历的 4 位数（如 4096）必须不剥」这条上游审计真正修掉的形态。
   *   残余风险：上下文长度恰好是合法 MMDD 的模型 id 会误继承基底能力——
   *   概率低（需要 4 位数且落在 01-01..12-31），且上游同样存在。
   */
  // 其它非日历形态
  for (const id of ['qwen2.5-coder-7b-instruct-2024', 'x-123', 'x-v2', 'x-1017-suffix']) {
    assert.equal(strip(id), id, `${id} 不是日历快照形态，不得剥`)
  }
})

await step('⑤ 月份/日期必须合法（`-1332` 这类非法月日不剥）', async () => {
  // 13 月、32 日都不存在 ⇒ 不该被当成日期
  for (const id of ['m-1332', 'm-1032', 'm-0000']) {
    assert.equal(strip(id), id, `${id} 的月/日非法（13月/32日/00月），不得当快照日期剥掉`)
  }
  // 合法边界应剥：01-01 / 12-31
  assert.equal(strip('m-0101'), 'm', '--0101 是合法日期（1月1日），应剥')
  assert.equal(strip('m-1231'), 'm', '--1231 是合法日期（12月31日），应剥')
})

await step('⑥ 查表真的走了回退版（不只定义了函数）', async () => {
  const src = fs.readFileSync(
    new URL('../vendor/channel-pack/src/cline-models-dev.ts', import.meta.url), 'utf8')
  assert.match(src, /const entry = findClineModelsDevEntry\(model\.id, dev\)/,
    'applyModelsDevCatalog 必须用回退版查表（直接 dev.get 会丢掉后缀模型的能力）')
  assert.doesNotMatch(src, /const entry = dev\.get\(model\.id\)/,
    '不得残留精确匹配的旧写法')
})

if (failed > 0) { console.error(`\nchannel-cline-snapshot-suffix: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-cline-snapshot-suffix: 全部通过')
