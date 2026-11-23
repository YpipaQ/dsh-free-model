/**
 * 模型上下架自适应（目录定时刷新）的回归钉子
 * （2026-11-02，用户要求「自适应模型上下架，实时」）。
 *
 *     node scripts/channel-catalog-refresh-test.mjs
 *
 * ## 钉住什么
 *
 * 1. **每家有远端目录的适配器都暴露 `refreshCatalog()`**（10 家：codearts、
 *    buddy/workbuddy 共用一个类、cline、lobsterai、loomy、minimax、raccoon、
 *    trae、zcode、accio）。漏一家 ⇒ 那家模型上下架仍要重启 DSH。
 * 2. **刷新后 `listModels` 真的看到新目录**（不是「清了个标记但列表没变」）。
 * 3. **刷新失败必须保留旧目录**，不得退回兜底子表 —— 一次网络抖动不该让用户
 *    少看到一批模型。
 * 4. **`index.ts` 的定时器真的在调它**（只写方法不接线 = 死代码）。
 * 5. **单飞 + 逐家容错**：一家失败不中断其余。
 *
 * ## 输入 / 输出
 *
 * - 输入：`pack.js`（真实挂载）＋ 桩 fetch/远端数据源。
 * - 输出：5 条断言；全过打印 `channel-catalog-refresh: 全部通过`。
 * - 边界：纯本地、不发网络。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const dir = path.join(root, 'vendor', 'channel-pack', 'src')

let failed = 0
async function step(name, fn) {
  try { await fn(); console.log(`ok  ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`) }
}

/** 必须有 refreshCatalog 的适配器（有远端目录的那些）。 */
const MUST_HAVE = [
  'llm-adapter.ts', 'buddy-adapter.ts', 'cline-adapter.ts', 'lobsterai-adapter.ts',
  'loomy-adapter.ts', 'minimax-adapter.ts', 'raccoon-adapter.ts', 'trae-adapter.ts',
  'zcode-adapter.ts', 'accio-adapter.ts',
]

await step('① 10 家适配器都暴露 refreshCatalog()（漏一家那家仍要重启才更新）', async () => {
  for (const f of MUST_HAVE) {
    const src = read(`vendor/channel-pack/src/${f}`)
    assert.match(src, /async refreshCatalog\(\): Promise<void> \{/,
      `${f} 必须暴露 refreshCatalog（否则那家的模型上下架仍要重启 DSH）`)
  }
})

await step('② 刷新必须真的清短路标记（否则 ensure/load 直接 return，列表不变）', async () => {
  // 两种短路形态：`remoteComplete`（codearts/cline/buddy）与
  // `remoteModels !== undefined`（lobsterai/trae/accio/loomy/minimax/raccoon/zcode）
  for (const f of MUST_HAVE) {
    const src = read(`vendor/channel-pack/src/${f}`)
    const seg = src.slice(src.indexOf('async refreshCatalog()'), src.indexOf('async refreshCatalog()') + 1600)
    const clearsComplete = /this\.remoteComplete = false/.test(seg)
    const clearsModels = /this\.remoteModels = undefined/.test(seg)
    assert.ok(clearsComplete || clearsModels,
      `${f} 的 refreshCatalog 必须清掉短路标记（remoteComplete 或 remoteModels），否则刷新是空操作`)
  }
})

await step('③ 刷新失败必须保留旧目录（不得退回兜底子表）', async () => {
  // 两种形态都要有「恢复旧值」的路径：
  // - ensure 型：remoteModels 仍为空 ⇒ 放回 previous
  // - load 型：同一个写法
  for (const f of MUST_HAVE) {
    const src = read(`vendor/channel-pack/src/${f}`)
    const seg = src.slice(src.indexOf('async refreshCatalog()'), src.indexOf('async refreshCatalog()') + 1600)
    // codearts/buddy 用的是 remoteComplete 形态：失败时 ensure 保留旧值（不需要额外恢复）
    const isCompleteStyle = /this\.remoteComplete = false/.test(seg) && !/const previous =/.test(seg)
    if (isCompleteStyle) {
      // 断言它**没有**顺手清 remoteModels（清了就会毁掉失败保留语义）
      assert.doesNotMatch(seg, /this\.remoteModels = undefined/,
        `${f}（remoteComplete 形态）不得清 remoteModels —— ensureRemoteModels 已在失败时保留旧值`)
      continue
    }
    // 其余形态必须有 previous + 恢复
    assert.match(seg, /const previous = this\.remoteModels/,
      `${f} 必须先把旧目录存下来（否则失败后它已被清空）`)
    assert.match(seg, /if \(this\.remoteModels === undefined && previous !== undefined\)/,
      `${f} 必须在新值为空时恢复旧值（否则刷新失败退回兜底子表）`)
  }
})

await step('④ 目录刷新必须真的有触发点（每日 + 账号变更；不再挂 30 分钟）', async () => {
  const src = read('vendor/channel-pack/src/index.ts')
  assert.match(src, /async function refreshAllCatalogs\(/, '应有 refreshAllCatalogs')

  // ⚠️ 2026-11-16 改版：目录刷新**从 30 分钟定时器移出**（模型上下架一天不变几次，
  // 30 分钟轮询纯浪费且撞上游限流）。改为「每日一次 + 账号变更时立即一次」。
  const timerSeg = src.slice(src.indexOf('const refreshTimer = setInterval'))
  const timerBody = timerSeg.slice(0, 700)
  assert.doesNotMatch(timerBody, /refreshAllCatalogs\(\)/,
    '30 分钟定时器**不得**再调 refreshAllCatalogs（那只该触发续期；'
    + '目录按 30 分钟轮询是浪费，见 2026-11-16 的改动理由）')
  assert.match(timerBody, /refreshAllCredentials\(\)/,
    '30 分钟定时器必须保留续期（access_token 只有 2 小时，这条不能降频）')

  // 触发点一：每日定时器
  assert.match(src, /scheduleDailyCatalog/, '应有每日目录刷新定时器')
  assert.match(src, /msUntilNextUtc8Midnight/, '每日刷新应对齐 UTC+8 零点（不是滑动 24h）')
  // 触发点二：账号变更
  assert.match(src, /pool\.onAccountsChanged = /, '账号变更必须接到目录刷新')
  assert.match(src, /refreshCatalogFor\(provider\)/, '账号变更应只刷变动的那一家')
  // ⚠️⚠️ 账号变更路径**不得**套用账号闸门：删掉最后一个账号时
  // `hasLoggedInAccount` 是 false，套闸门会跳过刷新 —— 而删除正是最需要刷的一次。
  const forSeg = src.slice(src.indexOf('async function refreshCatalogFor'))
  const forBody = forSeg.slice(0, 1600)
  assert.match(forBody, /hasAccount: undefined/,
    '账号变更触发的刷新**不得**带账号闸门（否则「删掉最后一个账号」时不会刷新，'
    + '目录收不掉那家的模型）')
  // 清理：两个定时器都要在 effect 里释放
  assert.match(src, /clearTimeout\(dailyCatalogTimer\)/, '每日定时器必须在 effect 清理里释放')
  assert.match(src, /pool\.onAccountsChanged = undefined/, '账号变更钩子必须随 effect 释放')
  // 单飞
  assert.match(src, /catalogRefreshInFlight/, '应有单飞标记（防上一轮没跑完就叠第二轮）')
  // 逐家容错 —— ⚠️ 按**结构**定位（函数体到下一个顶层 `async function`），
  // 不用「前 N 字符」：注释一长就会把断言挤出窗口，造成假红（本条已踩过一次）。
  // ⚠️ 逐家容错与账号闸门都在**抽出来的纯函数** `refreshCatalogsOnce` 里
  //（为了套件能测同一份实现，而不是另写夹具）。故在这里断言纯函数体 + 接线。
  const pureStart = src.indexOf('export function refreshCatalogsOnce')
  assert.ok(pureStart > 0, '应有可测的 refreshCatalogsOnce（纯函数）')
  const pureNext = src.indexOf('\nexport ', pureStart + 10)
  const pureSeg = src.slice(pureStart, pureNext > 0 ? pureNext : pureStart + 4000)
  assert.match(pureSeg, /catch \(error\)/, '逐家失败必须被捕获（一家失败不中断其余）')
  assert.match(pureSeg, /deps\.onError/, '失败应上报给调用方（由它记日志）')
  // ⚠️ 新增纪律：**没配账号的渠道不得刷新**（2026-11-09 用户报障：
  // 未配 cline 账号却每 30 分钟刷「models.dev 拉取失败 / 无可用凭据」）
  assert.match(pureSeg, /deps\.hasAccount/, '纯函数内必须有账号闸门')
  assert.match(pureSeg, /if \(!has\) continue/, '没账号必须 continue（不刷新）')
  // 接线：refreshAllCatalogs 必须把真实账号探针传进去
  const fnStart = src.indexOf('async function refreshAllCatalogs')
  const nextFn = src.indexOf('\n  async function ', fnStart + 10)
  const fnSeg = src.slice(fnStart, nextFn > 0 ? nextFn : fnStart + 6000)
  assert.match(fnSeg, /refreshCatalogsOnce\(\{/, 'refreshAllCatalogs 应调用纯函数')
  assert.match(fnSeg, /hasCatalogAccount/, '接线时必须传账号闸门')
  assert.match(fnSeg, /保留旧目录/, '失败日志应说明保留旧目录')
  assert.match(src, /async function hasCatalogAccount\(/, '应有 hasCatalogAccount 辅助函数')
})

await step('⑤ 行为：真实挂载后刷新，listModels 看到变化 + 失败保留旧值', async () => {
  // 用 buddy（它同时服务 buddy/workbuddy 两个产品，是本轮闭环验证的主力渠道）
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-catref-'))
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

  const stateDir = path.join(scratch, 'channel-pack')
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({
    accounts: [{
      id: 'buddy-one', provider: 'buddy', nickname: 'fixture',
      credentialRef: 'BUDDY_ACCOUNT_ONE', enabled: true, refreshable: true, createdAt: 1,
    }],
    disabledModels: {},
  }))

  const creds = new Map([['BUDDY_ACCOUNT_ONE', { value: JSON.stringify({
    access_token: 'fixture-token', refresh_token: 'fixture-refresh',
    expires_at: '2999-01-01T00:00:00Z',
  }) }]])
  const adapters = new Map()
  const services = {
    profileContext: { home: scratch },
    credentials: {
      resolve: async (ref) => creds.get(ref),
      describe: async () => undefined,
      set: async (ref, value) => { creds.set(ref, { value }) },
      unset: async (ref) => { creds.delete(ref) },
    },
    llm: {
      registerAdapter(providers, adapter) { for (const p of providers) adapters.set(p, adapter) },
      listProviders: () => [...adapters.keys()].map((id) => ({ id })),
    },
    connection: { fetch: { register() {} } },
  }
  const ctx = {
    ...services,
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => services[name],
    provide(name, service) { services[name] = service; this[name] = service },
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanup() },
    inject(names, callback) { if (names.every((n) => services[n] !== undefined)) callback(this) },
    emit() {},
  }

  // 可控远端目录：第一轮给 A 组，第二轮给 B 组；`fail` 时模拟网络故障
  const remoteState = { models: ['hy4-preview'], fail: false }
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/v3/config')) {
      if (remoteState.fail) throw new Error('network down')
      return Response.json({
        data: { models: remoteState.models.map((id) => ({ model_id: id, model_name: id, display_enabled: true })) },
      })
    }
    return Response.json({})
  }

  const { apply } = await import('../vendor/channel-pack/pack.js')
  apply(ctx, { disableOpencode: true })
  await new Promise((resolve) => setImmediate(resolve))

  const buddy = adapters.get('buddy')
  assert.ok(buddy, 'buddy adapter 必须注册')
  assert.equal(typeof buddy.refreshCatalog, 'function', '必须暴露 refreshCatalog')

  const idsOf = async () => (await buddy.listModels('buddy')).map((m) => m.id)

  // ① 首轮：A 组
  let before = await idsOf()
  assert.ok(before.length > 0, '首轮应有目录')
  // ② 远端换成 B 组，刷新
  remoteState.models = ['hy4-preview', 'glm-5.3']
  await buddy.refreshCatalog()
  let after = await idsOf()
  assert.ok(after.includes('glm-5.3'),
    `刷新后必须看到新模型（否则刷新是空操作）。前: ${before.join(',')} 后: ${after.join(',')}`)
  // ③ 模拟网络故障，再刷新 ⇒ 必须保留刚才那份好目录
  remoteState.fail = true
  await buddy.refreshCatalog()
  const afterFail = await idsOf()
  assert.ok(afterFail.includes('glm-5.3'),
    `刷新失败后必须保留旧目录（不得退回兜底子表）。实得: ${afterFail.join(',')}`)
})

await step('⑥b cline 的 ensureRemoteModels 入口必须有账号闸门（覆盖 3 个调用点）', async () => {
  /**
   * ⚠️ 只给 `listModels` 加门控**挡不住**另外两条入口：
   * - `listAllModels()`（同步契约，缓存为空时**后台**触发）
   * - `stream()`（判图片能力前读目录）
   *
   * ⇒ 闸门必须在 `ensureRemoteModels` 入口，一处覆盖三处。
   */
  const src = read('vendor/channel-pack/src/cline-adapter.ts')
  const start = src.indexOf('private async ensureRemoteModels()')
  assert.ok(start > 0, '应能找到 cline 的 ensureRemoteModels')
  const body = src.slice(start, start + 2000)
  assert.match(body, /hasLoggedInAccount/, 'ensureRemoteModels 入口必须查「有没有已登录账号」')
  assert.match(body, /if \(!loggedIn\) return/, '没账号必须直接返回（不拉目录/不拉 models.dev/不打日志）')
  // ⚠️ 三条边界
  // 实际写法：catch 在前，catch 体内 `loggedIn = true`（保守放行）
  assert.match(body, /catch \{\s*\n\s*loggedIn = true/, '读凭据异常应保守放行（不是挡死）')
  assert.doesNotMatch(body.slice(0, 2000), /this\.remoteComplete = true/,
    '没账号时**不得**置 remoteComplete —— 账号是后来才登录的，置 true 会让它永久不再拉')
})

await step('⑥ 行为：无账号渠道**不会被刷新**（2026-11-09 报障：未配 cline 却每 30 分钟刷）', async () => {
  // 用真实 AccountPool 验证 `hasLoggedInAccount` 的契约 —— 刷新器的闸门就挂在它上面。
  const poolMod = await import('../vendor/channel-pack/pack.js')
  assert.equal(typeof poolMod.refreshCatalogsOnce, 'function',
    'pack.js 应导出 refreshCatalogsOnce（供套件验证刷新闸门）')

  // 场景 A：完全没有账号 ⇒ 一次都不该刷
  const callsA = []
  await poolMod.refreshCatalogsOnce({
    // adapters：每项都是「有 refreshCatalog 就记一笔」的替身
    adapters: { cline: { refreshCatalog: async () => { callsA.push('cline') } },
      zcode: { refreshCatalog: async () => { callsA.push('zcode') } } },
    // hasAccount：全部 false（用户没配任何账号）
    hasAccount: async () => false,
  })
  assert.deepEqual(callsA, [],
    `没配账号的渠道**不得**触发目录刷新（实刷: ${callsA.join(',')}）—— `
    + '那正是「未配 cline 却每 30 分钟刷 models.dev 失败」的成因')

  // 场景 B：只有 buddy 有账号 ⇒ 只刷 buddy
  const callsB = []
  await poolMod.refreshCatalogsOnce({
    adapters: { buddy: { refreshCatalog: async () => { callsB.push('buddy') } },
      cline: { refreshCatalog: async () => { callsB.push('cline') } } },
    hasAccount: async (p) => p === 'buddy',
  })
  assert.deepEqual(callsB, ['buddy'],
    `只有配了账号的渠道才刷（实刷: ${callsB.join(',')}）`)

  // 场景 C：hasAccount 抛错 ⇒ 保守跳过（存储损坏不该刷出 15 条 warn）
  const callsC = []
  await poolMod.refreshCatalogsOnce({
    adapters: { cline: { refreshCatalog: async () => { callsC.push('cline') } } },
    hasAccount: async () => { throw new Error('storage corrupt') },
  })
  assert.deepEqual(callsC, [], '读凭据抛错时应保守跳过，而不是硬刷')

  // 场景 D：能力缺失（替身没有 hasLoggedInAccount）⇒ 照旧刷新（旧行为）
  const callsD = []
  await poolMod.refreshCatalogsOnce({
    adapters: { buddy: { refreshCatalog: async () => { callsD.push('buddy') } } },
    hasAccount: undefined,
  })
  assert.deepEqual(callsD, ['buddy'],
    '判不出账号时必须照旧刷新（单测替身常见形态，不能让替身把刷新整体挡掉）')
})

await step('⑦ 每日刷新对齐 UTC+8 零点（不是滑动 24h）', async () => {
  const { msUntilNextUtc8Midnight, CATALOG_DAILY_MS } = await import('../vendor/channel-pack/pack.js')
  assert.equal(typeof msUntilNextUtc8Midnight, 'function', '应导出 msUntilNextUtc8Midnight')
  assert.equal(CATALOG_DAILY_MS, 24 * 60 * 60 * 1000, '一天应是 86400000ms')

  const at = (iso) => Date.parse(iso)
  // 00:00:01 (UTC+8) ⇒ 距下一个零点约 1 天 - 1s（+5s 余量）
  const nearMidnight = msUntilNextUtc8Midnight(at('2026-11-16T00:00:01+08:00'))
  assert.ok(nearMidnight > CATALOG_DAILY_MS - 10_000 && nearMidnight <= CATALOG_DAILY_MS + 10_000,
    `零点刚过应几乎等一整天，实得 ${nearMidnight}`)

  // 23:59:59 ⇒ 只剩几秒（不是 24 小时）
  const beforeMidnight = msUntilNextUtc8Midnight(at('2026-11-16T23:59:59+08:00'))
  assert.ok(beforeMidnight > 0 && beforeMidnight < 15_000,
    `零点前 1 秒应只剩几秒，实得 ${beforeMidnight}（若是滑动 24h 会是 86400000）`)

  // 中午 ⇒ 约 12 小时，且**必须小于**一整天（证明是对齐零点而非滑动）
  const noon = msUntilNextUtc8Midnight(at('2026-11-16T12:00:00+08:00'))
  assert.ok(noon > 11 * 3600_000 && noon < 13 * 3600_000,
    `中午应约 12 小时，实得 ${noon}`)
  assert.ok(noon < CATALOG_DAILY_MS, '中午距下次零点必须小于 24h（滑动 24h 的写法这里会等于 24h）')

  // ⚠️ 边界：正好 00:00:00.000 ⇒ 必须排到**明天**（否则今晚漏刷一次）
  const exact = msUntilNextUtc8Midnight(at('2026-11-16T00:00:00+08:00'))
  assert.ok(exact > CATALOG_DAILY_MS - 10_000,
    `正好零点应排到明天零点（而非「4 秒后」），实得 ${exact}`)

  // UTC 时间等价性：UTC+8 的 00:00 = UTC 前一日 16:00
  const utcSame = msUntilNextUtc8Midnight(at('2026-11-15T16:00:01Z'))
  assert.ok(Math.abs(utcSame - nearMidnight) < 2000,
    `UTC 表示的同一时刻应算出同样的剩余（${utcSame} vs ${nearMidnight}）`)
})

await step('⑧ 账号变更只通知**变动的那一家**（不是全量重拉）', async () => {
  // 直接测纯逻辑：`writeAccounts` 的 before/after 差分算法。
  // ⚠️ 走真实 AccountPool 需要完整 ctx/存储，而这里的判据是**差分语义**，
  // 抽出来的成本远低于搭替身 —— 与 refreshCatalogsOnce 同一条思路。
  const mod = await import('../vendor/channel-pack/pack.js')
  const diff = mod.diffChangedProvidersForTest
  assert.equal(typeof diff, 'function', '应导出 diffChangedProvidersForTest（差分纯函数）')
  assert.ok(diff !== undefined)

  // 加账号：只报新增的那一家
  assert.deepEqual(diff('buddy:a1', 'buddy:a1,codearts:b1'), ['codearts'],
    '新增 codearts 账号 ⇒ 只报 codearts（不该让 15 家全重拉）')
  // 删账号
  assert.deepEqual(diff('buddy:a1,codearts:b1', 'buddy:a1'), ['codearts'], '删 codearts 只报 codearts')
  // 无变化 ⇒ 报空（不得触发刷新）
  assert.deepEqual(diff('buddy:a1', 'buddy:a1'), [], '集合没变时不得报任何 provider')
  // 同一 provider 内增删混合 ⇒ 仍只报一次该 provider
  assert.deepEqual(diff('buddy:a1', 'buddy:a2'), ['buddy'], '同 provider 换账号只报一次')
  // 两家同时变（⚠️ buddy 的号被删了，所以 buddy **也在变动之列** —— 我第一版
  // 期望值漏了它，是断言写错而非代码错）
  assert.deepEqual(diff('buddy:a1', 'codearts:b1,zcode:c1').sort(), ['buddy', 'codearts', 'zcode'],
    '删除 buddy + 新增 codearts/zcode ⇒ 三家都要报（删的那家也得刷，目录要收掉）')
  // 从空开始
  assert.deepEqual(diff('', 'buddy:a1'), ['buddy'], '空池首次加账号应报该 provider')
})

if (failed > 0) { console.error(`\nchannel-catalog-refresh: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-catalog-refresh: 全部通过')
