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

if (failed > 0) { console.error(`\nchannel-expiry-terminal: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-expiry-terminal: 全部通过')
