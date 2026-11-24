/**
 * TRAE 缓存命中率恒为 0 的回归钉子（上游同名修复，本 fork 移植）。
 *
 *     node scripts/channel-trae-cache-usage-test.mjs
 *
 * ## 钉住的缺陷
 *
 * SOLO 的 `token_usage` 事件把命中量**单列**在 `cache_read_input_tokens`，
 * 而 `prompt_tokens` 是**含缓存**的总输入。旧实现只读
 * `prompt_tokens` / `completion_tokens` / `reasoning_tokens`，
 * 把 `cache_read_input_tokens` 与 `cache_creation_input_tokens` **整对丢弃**。
 *
 * 后果不是少一个数字：DSH 的 usage 投影做 `usage.cacheReadTokens ?? 0`，
 * 字段缺席被归一成**数字 0** ⇒ 界面恒显示「缓存命中 0%」。
 *
 * ## 为什么必须钉「减法」与「三态」两条
 *
 * 1. 减法：TRAE 的 `prompt_tokens` 含缓存（与 Anthropic 相反）。若照抄
 *    `zcode-anthropic.ts` 不做减法，`inputTokens` 会把命中量再算一遍 ⇒
 *    命中率被系统性压低。这条只有断言**具体数值**才钉得住。
 * 2. 三态：`undefined`（未上报）/ `0`（明确未命中）/ `>0`（命中）不能折叠。
 *    折叠后「明确 0」与「未上报」逐字节相同，网关无法区分。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `traeUsageFromTokenUsage`（纯函数）。
 * - 输出：8 条断言；全过打印 `channel-trae-cache-usage: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-trae-cache-'))
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
const usageOf = pack.traeUsageFromTokenUsage
assert.equal(typeof usageOf, 'function',
  'pack.js 必须导出 traeUsageFromTokenUsage')

const checks = []
const check = (name, fn) => { fn(); checks.push(name) }

// ── 1. 实机样本（单前缀第 2 次请求，实测 glm-5.2）───────────────
// 原始事件：prompt_tokens=4894, cache_read=4864, cache_creation=0
check('缓存命中必须被读出来（实机样本）', () => {
  const usage = usageOf({
    prompt_tokens: 4894,
    completion_tokens: 32,
    total_tokens: 4926,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 4864,
    reasoning_tokens: 30,
  })
  assert.equal(usage.cacheReadTokens, 4864,
    'cache_read_input_tokens 必须映射到 cacheReadTokens')
  // 减法：未命中 = 4894 - 4864 - 0 = 30（**不是** 4894）
  assert.equal(usage.inputTokens, 30,
    'prompt_tokens 含缓存，必须减掉命中部分')
  assert.equal(usage.outputTokens, 32)
  assert.equal(usage.reasoningTokens, 30)
})

// ── 2. 冷启动：命中为 0 时必须明确回 0，而非缺席 ────────────────
check('明确回 0 与未上报必须可区分', () => {
  const cold = usageOf({ prompt_tokens: 4894, completion_tokens: 10, cache_read_input_tokens: 0 })
  assert.equal(cold.cacheReadTokens, 0,
    '上游明确报 0 时必须下发 0（三态里的「明确未命中」）')
  assert.equal(cold.inputTokens, 4894, '无命中时未命中量就是全部输入')

  const absent = usageOf({ prompt_tokens: 4894, completion_tokens: 10 })
  assert.equal('cacheReadTokens' in absent, false,
    '上游未上报时字段必须缺席（不能折叠成 0）')
})

// ── 3. 写入量：算输入但不算命中 ────────────────────────────────
check('缓存写入必须从输入里减掉但不算命中', () => {
  const usage = usageOf({
    prompt_tokens: 5000,
    completion_tokens: 5,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 2000,
  })
  assert.equal(usage.cacheReadTokens, 1000, '写入量不得计入命中')
  assert.equal(usage.cacheWriteTokens, 2000, '写入量要单列')
  assert.equal(usage.inputTokens, 2000, '未命中 = 5000 - 1000 - 2000')
})

// ── 4. 钳到 0：上游字段矛盾时不能下发负数 ──────────────────────
check('矛盾字段必须钳到 0 而非负数', () => {
  const usage = usageOf({
    prompt_tokens: 100,
    completion_tokens: 1,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 500,
  })
  assert.equal(usage.inputTokens, 0, 'TokenUsage 计数字段在 DSH 侧非负')
  assert.ok(usage.inputTokens >= 0)
})

// ── 5. 命中率口径：互斥后三项之和 == 原始总输入 ────────────────
check('互斥口径下三桶之和等于原始 prompt_tokens', () => {
  const raw = {
    prompt_tokens: 8000,
    completion_tokens: 7,
    cache_read_input_tokens: 6000,
    cache_creation_input_tokens: 500,
  }
  const u = usageOf(raw)
  const sum = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens
  assert.equal(sum, 8000, '拆分后总和必须等于原始总输入，不得漏算或多算')
  const hitPct = 100 * u.cacheReadTokens / sum
  assert.ok(hitPct > 70 && hitPct < 80,
    `命中率应约 75%，实际 ${hitPct.toFixed(1)}%`)
})

// ── 6. 防御性：浮点 / 负数 / 非数字按既有口径处理 ─────────────
check('非法计数字段按未上报处理', () => {
  const u = usageOf({
    prompt_tokens: 100,
    completion_tokens: 1,
    cache_read_input_tokens: -5,
  })
  assert.equal('cacheReadTokens' in u, false, '负数视为未上报')
  assert.equal(u.inputTokens, 100)
})

console.log('channel-trae-cache-usage: 全部通过（' + checks.length + ' 组）')
