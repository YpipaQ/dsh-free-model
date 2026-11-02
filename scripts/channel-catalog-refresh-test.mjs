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

await step('④ index.ts 的定时器真的在调 refreshAllCatalogs（只写方法=死代码）', async () => {
  const src = read('vendor/channel-pack/src/index.ts')
  assert.match(src, /async function refreshAllCatalogs\(/, '应有 refreshAllCatalogs')
  // 定时器回调里必须调用它
  const timerSeg = src.slice(src.indexOf('const refreshTimer = setInterval'))
  assert.match(timerSeg.slice(0, 400), /refreshAllCatalogs\(\)/,
    '定时器回调必须调用 refreshAllCatalogs（否则 30 分钟刷新永不发生）')
  // 单飞
  assert.match(src, /catalogRefreshInFlight/, '应有单飞标记（防上一轮没跑完就叠第二轮）')
  // 逐家容错
  const fnSeg = src.slice(src.indexOf('async function refreshAllCatalogs'))
  assert.match(fnSeg.slice(0, 2000), /catch \(error\)/, '逐家失败必须被捕获（一家失败不中断其余）')
  assert.match(fnSeg.slice(0, 2000), /保留旧目录/, '失败日志应说明保留旧目录')
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

if (failed > 0) { console.error(`\nchannel-catalog-refresh: ${failed} 项失败`); process.exit(1) }
console.log('\nchannel-catalog-refresh: 全部通过')
