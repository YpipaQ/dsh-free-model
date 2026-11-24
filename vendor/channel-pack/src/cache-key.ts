/**
 * 前缀缓存分桶键（`prompt_cache_key`）的解析。
 *
 * ## 为什么单独成文件
 *
 * buddy / workbuddy（`buddy-adapter.ts`）与 codearts（`llm-adapter.ts`）三家
 * 渠道共用同一套「腾讯/华为后端前缀缓存」语义，缺陷与修法完全一致 ⇒ 逻辑
 * 必须**一处定义**，否则下次只会修一半。
 *
 * ## 钉住的缺陷
 *
 * 两家适配器早期都把会话标识在**构造期**固化成实例常量：
 *
 * ```ts
 * // 构造期（只执行一次）
 * this.sessionId = options.sessionId ?? crypto.randomUUID().replace(/-/g, '')
 * // 请求期
 * prompt_cache_key: this.sessionId
 * ```
 *
 * 后果：**整个进程只有一个随机 key**。多个会话的前缀各不相同，却抢同一个
 * 缓存桶 ⇒ 服务端只能反复逐出彼此的缓存。实测（本机 26 天 token 账本）：
 *
 * | 渠道/模型 | 命中率 | 该模型当时的会话形态 |
 * |---|---|---|
 * | buddy/deepseek-v4.1-flash | 98.4% | 单会话独占 |
 * | buddy/hy4std | **24.4%** | 3 个会话交错 |
 * | buddy/hy3 | 0.7% | 短会话、无复用 |
 *
 * hy4std 那 125 步里 88 步是全价重算，浪费 73.2% 的输入token
 * —— 这正是「2000 积分一小时烧干」的直接来源。
 *
 * ## 正确来源：`GenerateOptions.sessionId`
 *
 * `dsh-agent-loop` 在**每轮请求**时填入真实会话标识（`sessionId: this.session.id`，
 * 见其 `buildRequest`）——同一会话内稳定、跨会话天然不同，正是前缀缓存需要的
 * 分桶键。DSH 一直提供了它，是适配器没读。
 *
 * ## 三态
 *
 * - 有 `options.sessionId`（agent-loop 的正常路径）⇒ 用它。
 * - 无（非 agent-loop 的一次性调用）⇒ 退回进程级随机值，与改动前行为一致。
 * - 类型异常（非字符串 / 空串）⇒ 同样退回，绝不把空串当 key 发出去。
 */

/**
 * 解析本次请求应使用的 `prompt_cache_key`。
 *
 * @param sessionId 调用方下发的会话标识（`GenerateOptions.sessionId`）。
 *   运行时是字符串，但类型上是可选 branded 值，故按 unknown 防御。
 * @param fallback 进程级兜底值（适配器构造期生成的随机串）。
 * @returns 非空字符串；`sessionId` 不可用时返回 `fallback`。
 */
export function resolveCacheKey(sessionId: unknown, fallback: string): string {
  if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId
  return fallback
}
