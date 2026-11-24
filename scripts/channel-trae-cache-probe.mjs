/**
 * TRAE 真机探针：上游到底回不回传 `cache_read_input_tokens`？
 *
 *     node scripts/channel-trae-cache-probe.mjs [model]
 *
 * ## 为什么要真机探针
 *
 * 离线单测只能证明「我们写了一个解析函数」，不能证明「上游确实发这个字段」。
 * 本探针**同前缀连发两次**，只统计 `token_usage` 事件的字段名与命中量，
 * 用来判定三种可能：
 *
 * 1. 第 2 次出现 `cache_read_input_tokens > 0` ⇒ 上游有缓存，是我们没解析（本修复命中）。
 * 2. 两次都为 0 / 字段缺席 ⇒ 上游未对 TRAE 开前缀缓存，改解析也无用。
 * 3. 网络 / 鉴权失败 ⇒ 无法判定，需换号重试。
 *
 * ## 隐私
 *
 * - 凭据只在进程内存里读 `.credentials.yaml`，**不打印、不落盘、不进 argv**。
 * - 只打印 `token_usage` 的**字段名与数值**，不打印模型输出正文。
 *
 * ## 输入 / 输出
 *
 * - 输入：本机 TRAE 账号凭据；可选参数指定模型（默认 `deepseek-v4.1-flash`）。
 * - 输出：两次请求的 `usage` 字段名列表 + 命中判定结论。
 * - 边界：**会真的消耗一次配额**；仅本机使用。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-trae-probe-'))
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
fs.mkdirSync(path.join(scratch, 'channel-pack'), { recursive: true })
fs.writeFileSync(path.join(scratch, 'channel-pack/state.json'), JSON.stringify({ accounts: [], disabledModels: {} }))

const pack = await import('../vendor/channel-pack/pack.js')

const MODEL = process.argv[2] ?? 'deepseek-v4.1-flash'
const ENDPOINT = 'https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat'

// ── 读凭据（内存内解析，不打印）────────────────────────────────
const credText = fs.readFileSync(path.join(process.env.HOME, '.dsh/.credentials.yaml'), 'utf8')
const refName = process.env.TRAE_CRED_REF ?? 'TRAE_ACCOUNT_86166791'
const lineRe = new RegExp(`^\\s*${refName}:\\s*'?(\\{.*?\\})'?\\s*$`, 'ms')
const match = credText.match(lineRe)
if (!match) {
  console.error(`未找到凭据 ${refName}（可用 TRAE_CRED_REF 指定）`)
  process.exit(2)
}
const credential = JSON.parse(match[1])
if (typeof credential.access_token !== 'string') {
  console.error('凭据缺少 access_token')
  process.exit(2)
}

// ── 构造请求体：同前缀，只换最后一句 ──────────────────────────
// ⚠️ 前缀必须**足够长**：前缀缓存普遍有最小长度门槛（常见 1024~2048 token），
// 太短的前缀两次都不会命中，会把「未达门槛」误判成「上游没开缓存」。
const PAD_REPEAT = Number(process.env.TRAE_PROBE_PAD ?? 500)
// ⚠️ 填充必须**低重复度**：整段复述同一句会被服务端按内容去重/压缩，
// 实测重复填充 500 次仍两次都不命中；改为逐句带序号的写实文本后才有命中。
const filler = Array.from({ length: PAD_REPEAT }, (_, i) =>
  `第 ${i + 1} 条前置事实：编号 ${i * 7 + 13} 的记录在 ${2020 + (i % 5)} 年第 ${(i % 12) + 1} 月完成归档，责任部门为部门${String.fromCharCode(65 + (i % 26))}，备注字段填写为「例行检查通过」。`).join('')
const baseMessages = [
  { role: 'system', content: '你是一个测试助手，只回一个字。' },
  { role: 'user', content: filler + '\n请回答：好' },
]

const product = pack.TRAE_PRODUCT_FOR_TEST

/** 发一次请求，返回所有 `token_usage` 事件的原始对象。 */
// ⚠️ 真实会话**总是**带 tools（DSH 内置 20+ 个）。前缀缓存的锚点常常是
// tools 段 + system 段；只发 messages 的探针会漏掉这一段，实测两次都不命中。
const PROBE_TOOLS = Number(process.env.TRAE_PROBE_TOOLS ?? 1) === 1
  ? Array.from({ length: 20 }, (_, i) => ({
    type: 'function',
    function: {
      name: `probe_tool_${i}`,
      description: `第 ${i} 个探针工具，用于撑起 tools 前缀段，参数无实际作用。`,
      parameters: {
        type: 'object',
        properties: { arg: { type: 'string', description: `参数 ${i}` } },
        required: ['arg'],
      },
    },
  }))
  : undefined

async function probe(label, messages) {
  const body = pack.transformToSOLOBody(
    { model: MODEL, messages, stream: true, ...PROBE_TOOLS !== undefined ? { tools: PROBE_TOOLS } : {} },
    undefined,
  )
  // ⚠️ Max 模式（1M 上下文）是**另一套与会话策略**：本机真实会话每步 54万~80万
  // token 必然走 Max，而 Max 才可能启用服务端缓存。探针必须能复现这一层。
  if (process.env.TRAE_PROBE_MAX === '1') {
    Object.assign(body, pack.traeMaxModeFields(1_000_000))
  }
  // 对照实验：Buddy/CodeArts 靠 `prompt_cache_key` 启用腾讯侧前缀缓存，
  // 上游对 TRAE 明确「不发」。此处强行补发，验证 TRAE 是否也认这个键。
  if (process.env.TRAE_PROBE_CACHE_KEY !== undefined) {
    body.prompt_cache_key = process.env.TRAE_PROBE_CACHE_KEY
    body.session_id = process.env.TRAE_PROBE_CACHE_KEY
    body.conversation_id = process.env.TRAE_PROBE_CACHE_KEY
  }
  const headers = pack.traeSOLOHeaders(credential, product, true, 0)
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status} — 无法判定（鉴权/端点问题）`)
    return undefined
  }
  const text = await res.text()
  const usages = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.startsWith('event:') && !line.startsWith('data:')) continue
    if (line.startsWith('event:')) { var evName = line.slice(6).trim(); continue }
    const data = line.slice(5).trim()
    if (data.length === 0) continue
    let parsed
    try { parsed = pack.parseTraeSSELine(evName ?? '', data) } catch { continue }
    if (parsed?.event === 'token_usage' && parsed.usage !== undefined) usages.push(parsed.usage)
  }
  const last = usages.at(-1)
  if (last === undefined) {
    console.log(`${label}: 未收到 token_usage 事件（SSE 片段 ${text.length} 字节）`)
    if (process.env.TRAE_PROBE_RAW === '1') console.log(`${label}: 片段 = ${text.slice(0, 400)}`)
    return undefined
  }
  console.log(`${label}: 字段 = ${Object.keys(last).join(', ')}`)
  if (process.env.TRAE_PROBE_RAW === '1') console.log(`${label}: 原始 = ${JSON.stringify(last)}`)
  console.log(`${label}: prompt_tokens=${last.prompt_tokens} `
    + `cache_read_input_tokens=${last.cache_read_input_tokens} `
    + `cache_creation_input_tokens=${last.cache_creation_input_tokens}`)
  console.log(`${label}: 归一后 = ${JSON.stringify(pack.traeUsageFromTokenUsage(last))}`)
  return last
}

// ⚠️ 真实会话不是「同问题发两次」，而是**逐步增长**：每步在尾部追加。
// 带 growth=1 时按「前缀固定 + 尾部生长」发 3 次，这才是缓存该命中的形态。
const GROW = Number(process.env.TRAE_PROBE_GROW ?? 0) === 1
let first, second
if (GROW) {
  const turns = [
    baseMessages,
    [...baseMessages, { role: 'assistant', content: '好' }, { role: 'user', content: '继续，再回答：好' }],
    [...baseMessages, { role: 'assistant', content: '好' }, { role: 'user', content: '继续，再回答：好' },
      { role: 'assistant', content: '好' }, { role: 'user', content: '再来一次：好' }],
  ]
  for (const [i, msgs] of turns.entries()) {
    const r = await probe(`增长第 ${i + 1} 次`, msgs)
    if (i === 0) first = r
    if (i === turns.length - 1) second = r
  }
} else {
  first = await probe('第 1 次（冷）', baseMessages)
  second = await probe('第 2 次（同前缀）', baseMessages)
}

console.log('\n── 结论 ──')
if (first === undefined || second === undefined) {
  console.log('无法判定：请求未成功。')
} else {
  const hit = Number(second.cache_read_input_tokens ?? 0)
  const firstHit = Number(first.cache_read_input_tokens ?? 0)
  if (hit > 0) {
    console.log(`上游确实回传缓存命中（冷=${firstHit}，复用=${hit}）⇒ 修复口径正确。`)
  } else if ('cache_read_input_tokens' in second) {
    console.log(`字段存在但两次都是 0（冷=${firstHit}，复用=${hit}）⇒ 上游未对该模型开前缀缓存。`)
  } else {
    console.log('字段完全缺席 ⇒ 上游不下发缓存信息，解析层无从修复。')
  }
}
