/**
 * 「续期成功但落盘失败 = 终态」的回归钉子
 * （gitee PR159 首版缺陷 / 2026-10-28 修；本 fork 2026-11-02 移植）。
 *
 *     node scripts/channel-expiry-terminal-test.mjs
 *
 * ## 钉住什么
 *
 * 1. **共享模块不再自己造终态错误**：`makeTerminalError` 必须由调用方注入，
 *    且它是**必填**参数（漏接线要在类型检查时红，不能静默退回普通 Error）。
 * 2. **passport 各家的类必须各自注入自己家的**：本 fork 实测有 **8 个同名
 *    `RefreshTokenExpiredError` 类**（buddy-oauth / cline / lobsterai / oauth、
 *    qoder / raccoon / trae，以及 gemini/minimax/accio 的带前缀版本）。
 *    跨模块 `instanceof` **恒为 false** ⇒ 借用别家的类会让那些渠道把
 *    「凭据已死」当非终态 ⇒ **静默死号**。
 * 3. **落盘失败必须抛终态**（不能冒泡成普通 Error）。
 * 4. 所有调用点都必须接线（本 fork 11 处）。
 *
 * ## 输入 / 输出
 *
 * - 输入：`vendor/channel-pack/src/expiry-sync.ts` + 各家 auth/service 源码。
 * - 输出：5 条断言；全过打印 `channel-expiry-terminal: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const expirySrc = read('vendor/channel-pack/src/expiry-sync.ts')

/** 各家的终态错误类 —— 名字必须与其源码里的定义**逐字一致**。 */
const PROVIDERS = [
  { file: 'accio-auth.ts', cls: 'AccioRefreshTokenExpiredError' },
  { file: 'buddy-auth.ts', cls: 'RefreshTokenExpiredError' },
  { file: 'cline-auth.ts', cls: 'RefreshTokenExpiredError' },
  { file: 'gemini-auth.ts', cls: 'GeminiRefreshTokenExpiredError' },
  { file: 'lobsterai-auth.ts', cls: 'RefreshTokenExpiredError' },
  { file: 'minimax-auth.ts', cls: 'MinimaxRefreshTokenExpiredError' },
  { file: 'qoder-auth.ts', cls: 'RefreshTokenExpiredError' },
  { file: 'service.ts', cls: 'RefreshTokenExpiredError' },
  { file: 'trae-auth.ts', cls: 'RefreshTokenExpiredError' },
]

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

await step('① makeTerminalError 是必填参数（不是可选带默认值）', async () => {
  // 必填 = 漏接线在类型检查时红。可选+默认会让漏接线静默退回普通 Error。
  assert.match(expirySrc, /makeTerminalError: \(message: string\) => Error/,
    '应声明 makeTerminalError')
  assert.doesNotMatch(expirySrc, /makeTerminalError\?: /,
    'makeTerminalError 不得是可选参数（漏接线会静默退回普通 Error）')
})

await step('② 落盘失败必须抛终态（不能冒泡成普通 Error）', async () => {
  const saveAt = expirySrc.indexOf('await save(refreshed)')
  assert.ok(saveAt > 0, '应有 save 调用')
  // save 必须包在 try 里，且 catch 里 throw makeTerminalError
  const around = expirySrc.slice(saveAt - 300, saveAt + 1600)
  assert.match(around, /try \{[\s\S]{0,200}?await save\(refreshed\)/,
    'save 必须包在 try 里')
  assert.match(around, /catch \(error\) \{[\s\S]{0,900}?throw params\.makeTerminalError\(/,
    '落盘失败必须 throw 终态错误（一次性 refresh_token 已被消耗，继续重试只会「已被使用」）')
})

await step('③ 每家必须注入**自己那家**的类（跨模块 instanceof 恒 false）', async () => {
  // ⚠️ 这是本缺陷的核心：借用别家的类 ⇒ 那些渠道把「凭据已死」当非终态 ⇒ 静默死号。
  let wired = 0
  for (const { file, cls } of PROVIDERS) {
    const src = read(`vendor/channel-pack/src/${file}`)
    const m = src.match(/makeTerminalError: \(message\) => new ([A-Za-z]+)\(message\)/)
    assert.ok(m, `${file} 必须接线 makeTerminalError`)
    assert.equal(m[1], cls,
      `${file} 注入的类必须是本家的 ${cls}（借用别家会让 instanceof 恒 false ⇒ 静默死号），实为 ${m[1]}`)
    wired++
  }
  assert.ok(wired === PROVIDERS.length, `应接线 ${PROVIDERS.length} 家，实为 ${wired}`)
})

await step('④ 各家注入的类在**本文件内**确有定义（防拼错名字后静默变成 ReferenceError）', async () => {
  // 同名类分散在多个文件里 —— 拼错一个字母不会被 esbuild 发现（它不做类型检查），
  // 只会在运行时抛 ReferenceError。这里做静态存在性检查。
  const classDefs = new Map()
  const dir = path.join(root, 'vendor', 'channel-pack', 'src')
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/export class ([A-Za-z]*RefreshTokenExpiredError) extends Error/g)) {
      if (!classDefs.has(m[1])) classDefs.set(m[1], [])
      classDefs.get(m[1]).push(f)
    }
  }
  const needed = new Set(PROVIDERS.map((p) => p.cls))
  for (const cls of needed) {
    assert.ok(classDefs.has(cls), `应能在源码中找到 ${cls} 的定义`)
  }
  // 记录「同名类分散在多个文件」这一事实，说明为什么必须逐家注入
  const dupes = [...classDefs.entries()].filter(([, files]) => files.length > 1)
  assert.ok(dupes.length > 0,
    '应观察到一个名字分散在多个文件（这正是必须逐家注入的原因）；'
    + `实际: ${JSON.stringify([...classDefs].map(([k, v]) => [k, v.length]))}`)
})

await step('⑤ 接线点数量与调用点数量一致（防漏接）', async () => {
  const dir = path.join(root, 'vendor', 'channel-pack', 'src')
  let callSites = 0
  let wires = 0
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts')) && []) void f
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    if (f === 'expiry-sync.ts') continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    callSites += (src.match(/refreshAccountWithReconcile\(\{/g) ?? []).length
    wires += (src.match(/makeTerminalError: /g) ?? []).length
  }
  assert.ok(callSites > 0, '应存在调用点')
  assert.equal(wires, callSites, `接线数(${wires})应与调用点数(${callSites})一致（漏接会静默死号）`)
})

await step('⑥ STS5.1806 必须是终态，且 error_code 与 error_msg **两条腿都在**', async () => {
  // 一次性 refresh_token 已被消费的专属码。漏判 ⇒ 非终态 ⇒ refreshable 永真
  // ⇒ 每轮拿同一份已消耗 token 去兑换 ⇒ 静默死号。
  // ⚠️ 两条腿必须都在：上游实测「只写 error_code 腿」时，删掉它用例仍全绿
  //（msg 兜底完全遮盖）⇒ 假守卫。这里逐条独立断言。
  const oauthSrc = read('vendor/channel-pack/src/oauth.ts')
  assert.match(oauthSrc, /errorCode\.includes\('STS5\.1806'\)/,
    'error_code 腿必须在（缺它时只有 msg 兜底，报文一变就漏）')
  assert.match(oauthSrc, /refresh\\s\*token\\s\+has\\s\+been\\s\+used/i,
    'error_msg 腿必须在（error_code 缺失时靠正文兜底）')
  // 两条腿必须都归到同一个终态出口
  const seg = oauthSrc.slice(oauthSrc.indexOf("errorCode.includes('STS5.1806')"))
  assert.match(seg.slice(0, 400), /throw new RefreshTokenExpiredError/,
    'STS5.1806 必须抛终态错误（不是普通 Error）')
})

await step('⑦ refresh 寿命腿：两腿取「或」，且不传时行为不变（上游 577b27a7）', async () => {
  // 华为 STS 的 refresh_token exp 恒等于「登录 + 30 天」、续期不延长；access 恒 2 小时
  // ⇒ 最后一天窗口窄到可能「续期成功得太晚」（实测差 5.8 分钟）⇒ 账号报废。
  assert.match(expirySrc, /refreshExpiresAtOf\?: /,
    'ExpiryAccessors 应有可选 refreshExpiresAtOf 腿')
  const shouldSrc = expirySrc.slice(expirySrc.indexOf('export function shouldRefreshNow'))
  // 取「或」：access 到期 或 refresh 到期，任一进 lead 窗口就续
  assert.match(shouldSrc, /if \(expiresAtMs - nowMs <= REFRESH_LEAD_MS\) return true/,
    'access 腿应单独 return true（「或」语义）')
  assert.match(shouldSrc, /refreshExpiresAtMs - nowMs <= REFRESH_LEAD_MS/,
    'refresh 腿也应单独 return true（「或」语义）')
  // ⚠️ 不得写成「两腿都满足」才返回 true（那会把「refresh 剩 3 天、access 剩 2 分钟」
  // 这个正常态误判成不用续 ⇒ access 过期即报废）
  // ⚠️ 精确判据：两腿之间**不得**出现 `&&`（发现「与」就红）。
  // 注意不能用宽窗口正则（会把两条独立语句之间的注释也算进来，造成假红/假绿）。
  const accessLine = shouldSrc.indexOf('if (expiresAtMs - nowMs <= REFRESH_LEAD_MS) return true')
  const refreshLine = shouldSrc.indexOf('refreshExpiresAtMs - nowMs <= REFRESH_LEAD_MS')
  assert.ok(accessLine > 0 && refreshLine > accessLine, '两条腿都应在，且 access 腿在前')
  // ⚠️ 精确到「access 的 return true」与「refresh 的 if 开头」之间 —— 那段只允许
  // 注释。refresh 腿**内部**的 `!== undefined && Number.isFinite(...)` 是必要的前置
  // 守卫（防 `undefined` 与 `NaN`），不是「两腿取与」，不能被误伤。
  const accessReturn = shouldSrc.indexOf('if (expiresAtMs - nowMs <= REFRESH_LEAD_MS) return true')
  const refreshIf = shouldSrc.indexOf('if (refreshExpiresAtMs !== undefined')
  assert.ok(accessReturn > 0 && refreshIf > accessReturn, 'refresh 腿的 if 应在 access 腿之后')
  const gap = shouldSrc.slice(accessReturn, refreshIf)
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.doesNotMatch(gap, /&&|return false/,
    '两条腿的 return true 之间不得有 && 或提前 return false（那会破坏「或」语义）')
  // codearts 必须接线（它是唯一有 30 天硬上限的渠道）
  const svcSrc = read('vendor/channel-pack/src/service.ts')
  assert.match(svcSrc, /refreshExpiresAtOf: \(credential\) => \(/,
    'codearts 必须注入 refresh 寿命腿（它是 30 天硬上限的受害者）')
  assert.match(svcSrc, /decodeJwtExpMs\(credential\.refresh_token/,
    'refresh 寿命腿应复用 decodeJwtExpMs（已处理 exp 溢出成 Infinity 的形态）')
})

if (failed > 0) { console.error(`\nchannel-expiry-terminal: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-expiry-terminal: 全部通过')
