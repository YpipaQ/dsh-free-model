/**
 * 前缀缓存分桶键必须「逐请求」而非「全进程一个」的回归钉子。
 *
 *     node scripts/channel-cache-key-test.mjs
 *
 * ## 钉住的缺陷（严重：直接烧钱）
 *
 * buddy / workbuddy（`buddy-adapter.ts`）与 codearts（`llm-adapter.ts`）早期都在
 * **构造期**把会话标识固化成实例常量，于是整个进程只有一个随机
 * `prompt_cache_key`。多个会话的前缀各不相同却抢同一个缓存桶 ⇒ 服务端反复
 * 逐出彼此的缓存。
 *
 * 实测（本机 26 天 token 账本）：
 *
 * | 渠道/模型 | 命中率 | 当时的会话形态 |
 * |---|---|---|
 * | buddy/deepseek-v4.1-flash | 98.4% | 单会话独占 |
 * | buddy/hy4std | **24.4%** | 3 个会话交错 |
 *
 * `dsh-agent-loop` 每轮都下发真实 `sessionId`（`sessionId: this.session.id`），
 * 缺陷在于适配器没读它。
 *
 * ## 为什么这样测
 *
 * 缺陷是「取值来源」的选择，走 `stream()` 要装凭据、发网络，且断言的落点
 * （出站请求体里的 key）在离线桩里不可达。故把取值逻辑抽成纯函数
 * `resolveCacheKey` 直接测，并用**变异**确认钉子有牙：
 * 把实现改回「永远返回 fallback」必须红。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js` 导出的 `resolveCacheKey`（纯函数）。
 * - 输出：5 组断言；全过打印 `channel-cache-key: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-cache-key-'))
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
const resolveCacheKey = pack.resolveCacheKey
assert.equal(typeof resolveCacheKey, 'function',
  'pack.js 必须导出 resolveCacheKey')

const FALLBACK = 'fallbackProcessWideKey'
const checks = []
const check = (name, fn) => { fn(); checks.push(name) }

// ── 1. 核心：不同会话必须得到不同 key ──────────────────────────
check('两个不同会话必须映射到不同缓存键', () => {
  const a = resolveCacheKey('session-aaa', FALLBACK)
  const b = resolveCacheKey('session-bbb', FALLBACK)
  assert.equal(a, 'session-aaa', '必须采用调用方下发的会话标识')
  assert.equal(b, 'session-bbb')
  assert.notEqual(a, b,
    '不同会话必须分到不同桶；若相等说明退化成了全进程一个 key')
})

// ── 2. 同一会话内必须稳定（否则缓存无法复用）──────────────────
check('同一会话多次请求必须返回同一键', () => {
  const first = resolveCacheKey('session-aaa', FALLBACK)
  const second = resolveCacheKey('session-aaa', FALLBACK)
  assert.equal(first, second,
    '同一会话的键必须跨请求稳定，否则等于没有缓存')
})

// ── 3. 无会话标识时退回兜底（非 agent-loop 的一次性调用）────────
check('缺少会话标识时退回兜底值', () => {
  assert.equal(resolveCacheKey(undefined, FALLBACK), FALLBACK)
})

// ── 4. 空串 / 非字符串不得当作有效 key ────────────────────────
check('空串与类型异常一律退回兜底', () => {
  assert.equal(resolveCacheKey('', FALLBACK), FALLBACK,
    '空串当 key 会让所有会话挤进同一个桶')
  assert.equal(resolveCacheKey(null, FALLBACK), FALLBACK)
  assert.equal(resolveCacheKey(123, FALLBACK), FALLBACK,
    'branded 类型运行时若被误塞数字，必须防御')
  assert.equal(resolveCacheKey({}, FALLBACK), FALLBACK)
})

// ── 5. 真实形态：DSH 的 sessionId 形如 session-<uuid> ──────────
check('真实会话标识形态可原样透传', () => {
  const real = 'session-eefb2088-91c5-475b-87bf-708aa8ac82d1'
  assert.equal(resolveCacheKey(real, FALLBACK), real)
  // 三个并发会话 → 三个不同桶（这正是 hy4std 修复的场景）
  const keys = new Set([
    resolveCacheKey('session-4591dcb7-aee8', FALLBACK),
    resolveCacheKey('session-1f98375f-8084', FALLBACK),
    resolveCacheKey('session-6d289bd0-b928', FALLBACK),
  ])
  assert.equal(keys.size, 3, '三个并发会话必须落在三个不同桶')
})

console.log('channel-cache-key: 全部通过（' + checks.length + ' 组）')
