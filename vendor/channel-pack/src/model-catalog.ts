/**
 * 模型目录的**共享骨架**（设计文档 §3.5.4）。
 *
 * ## 它解决什么
 *
 * 14 家的 `listModels` / `resolveModel` / `listAllModels` 三个方法此前各自实现，
 * 但骨架**逐字同构**（实测：`loomy` / `minimax` / `raccoon` 三家归一化后逐字相同）：
 *
 * ```
 * listModels(provider)
 *   ├─ ① providerCatalogVisible(accountPool, product.id)?
 *   │      └─ 否 → 返回 []，**绝不抛错**
 *   ├─ ② 读目录（远端缓存 ?? 兜底表）
 *   ├─ ③ 黑名单过滤（disabledModelsFor）
 *   └─ ④ map → { provider: product.id, id, name, inputModalities }
 *
 * resolveModel(provider, model)      ← ⚠️ provider/id 必须按入参回填
 *   ├─ ① 按 id 找 entry（**找不到不抛错**）
 *   ├─ ② name：entry.bareName → entry.name → **裸 model**（三级回退，绝不空）
 *   │      ⚠️ **`bareName` 优先**，与设计文档 §3.5.4.3 写的「entry.name →
 *   │         entry.bareName」**相反** —— 以实现为准，理由见 `resolveModel` 内注释。
 *   │         （本节原先把顺序写反了，2026-10-08 复审修正。）
 *   ├─ ③ context：未知就不声明
 *   ├─ ④ maxTokens：可选
 *   └─ ⑤ reasoning：efforts 非空才声明；defaultEffort 必须落在 efforts 内
 * ```
 *
 * 各家仍在自己模块内做一次 `toCatalogEntry()` —— 把「私有形状」转成本文件的
 * `CatalogEntry`。此后共享骨架**不再关心原始形状**。
 *
 * ## ⚠️ 边界（别把这里做成「一套配置驱动 14 家」）
 *
 * 抽象的是**骨架**（顺序、回填、三态、过滤），**不是协议**：
 * - 倍率是否拼进 `name`、怎么剥掉 —— 各家在 `toCatalogEntry` 里决定；
 * - `inputModalities` 的**两种来源**（静态表按 id 查 / 远端对象读字段）——
 *   在 `toCatalogEntry` 里收敛成**一个字段**；
 * - 兜底表长什么样 —— 各家私有（`loadCatalog` 内部自己选）。
 */

import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'

import { providerCatalogVisible, type AccountPool } from './account-pool.js'

/**
 * 各家的**中间结构** —— 只承载「DSH 契约需要什么」，不承载私有信息。
 *
 * ⚠️ 缺省语义全部是「**省略即不声明**」（而不是给一个默认值）：
 * DSH 侧对「未知」与「明确否定」的处理**不同**（见 `inputModalities`）。
 */
export interface CatalogEntry {
  readonly id: string
  /**
   * **目录展示名**（`listModels()` 用）。
   *
   * ⚠️ 倍率是否拼进来由**各家在转换时**决定（buddy / loomy / raccoon 拼，
   * codearts 不拼）—— 真实差异，保留在各家的 `toCatalogEntry` 里。
   */
  readonly name: string
  /**
   * **`resolveModel` 用的裸名**（不带倍率）。
   *
   * ⚠️ **提供它即表示「`resolveModel` 用这个、不用 `name`」**（它优先于 `name`）。
   * 省略时 `resolveModel` 回退到 `name`。
   *
   * ⚠️ 必须与 `name` 分成两个字段：`raccoon-adapter.ts` 与 `loomy-adapter.ts`
   * 都做「剥掉 ` · x{n}` 后缀」，而 `listModels` 用带倍率的、`resolveModel` 用裸的。
   * 若只留一个 `name`，剥离逻辑就得回到共享骨架里 —— 那会让骨架**认识倍率格式**，
   * 而各家格式不同（loomy 用 `splitLoomyRate`，raccoon 用正则）。
   */
  readonly bareName?: string
  /**
   * 可选描述（DSH 的 `LlmModelInfo.description`）。
   *
   * ⚠️ **设计文档的 `CatalogEntry` 漏了这个字段**（2026-10-08 预检发现）：
   * `cline-adapter.ts` 与 `lobsterai-adapter.ts` 都会下发它，漏掉就是**静默丢字段**。
   * ⚠️ 但**免费标记不要写这里** —— `cline-adapter.ts` 有铁律：
   * 「免费模型在 `name` 里拼 ` · 免费`。**必须写进 `name` 而非 `description`**」。
   */
  readonly description?: string
  /**
   * 输入模态。**三态**（DSH 的类型注释原文：`absent means unknown, while an
   * explicit omission is negative capability`）：
   * - 数组 = 已知能力；
   * - **省略 = 未知**（交给宿主判断）；
   * - `['text']` = **明确声明不支持图片**（图片会被拒）。
   *
   * ⚠️ **两者后果不同，不能合并**：把「未知」写成 `['text']` 会**静默把图片能力
   * 关掉** —— 功能看似正常，只是图片发不出去（`buddy` 实测会拿不到远端能力表）。
   */
  readonly inputModalities?: readonly ('text' | 'image')[]
  /** 上下文窗口；`undefined` ⇒ **不声明**（不编造假窗口）。 */
  readonly contextWindow?: number
  /** 单次输出上限；`undefined` ⇒ 不声明。 */
  readonly maxTokens?: number
  /** 思考档位；`undefined` ⇒ 不声明（UI 不出现档位选择器）。 */
  readonly reasoning?: LlmResolvedModelInfo['reasoning']
  /** 是否免费（供 Jet Hub 模型列表分组）。 */
  readonly isFree?: boolean
}

export interface ModelCatalogDeps {
  readonly accountPool?: AccountPool
}

export interface ModelCatalogConfig {
  readonly product: { readonly id: string }
  /**
   * **目录里没有该 id** 时 `resolveModel` 该报什么模态。
   *
   * ⚠️⚠️ **本字段是「三态」里最容易做错的一处**（Task 7b 实测踩到）。
   * 各家对「未知模型 id」的处理**不同**，且**不能统一**：
   *
   * | 家 | 未知 id ⇒ | 理由 |
   * |---|---|---|
   * | `buddy`（含 `workbuddy`） | **省略该字段**（不提供本回调） | 它的 `inputModalitiesFor` 用 `imageCapabilityKnown` 区分「明确 false」与「全都没查到」，后者**只报未知**（交给宿主判断） |
   * | 其余 **12 家** | `['text']` | **保守报 text**：宁可少报能力（用户改用文本描述），也不要报一个服务端可能不认的模态 |
   *
   * ⚠️ **家数实测为 12（2026-10-08 二次复核修正）** —— 本节先后写错过**两次**：
   * 原写「**5 家**」（`loomy/minimax/raccoon/gemini/qoder`，本字段刚引入时的快照），
   * 再改「**10 家**」（那数是**源码处数**，不是家数），现按**家数**修正为 12。
   *
   * ⚠️ **两个口径必须分清**（这正是上一次改错的原因）：
   *
   *     源码处数 = 10 —— `unknownModelInputModalities` 这个键在 `src/` 里出现 10 次
   *                 （`qoder-adapter.ts` 一处同时服务 `qoder` 与 `qodercn`）
   *     家数     = 12 —— 14 个 `channel` provider 里，减去 `buddy`/`workbuddy`
   *                 （二者共用适配器、都省略该键）
   *
   * ⚠️ 14 家里 `opencode` **不走本骨架**（门控/黑名单/模态/context 有协议级差异），
   * 但它**同样**对未知 id 保守报 `['text']`，故它在「12 家」里。
   * 复核方式：剥注释后数**代码里**有没有这个键，别把注释本身或目录转换算进来。
   * ⚠️ 该名单有**逐 provider 的行为守卫**（`model-catalog-parity.spec.ts` 的
   * `OMIT_UNKNOWN_MODALITIES`，跑真实适配器）—— 名单再腐坏会点名到具体哪一家。
   *
   * ⚠️ 若把这 12 家统一成「省略」，用户手填的未知模型会从「明确不支持图片」
   * 变成「未知」⇒ **图片会被放行**、发到不支持的服务端（请求失败）。
   * 反之若把 `buddy` 统一成 `['text']`，会**静默关掉图片能力**（见
   * `CatalogEntry.inputModalities` 的说明）。
   * ⇒ **两个方向都会出真缺陷，故本回调必须逐家提供**，骨架不替各家决定。
   */
  unknownModelInputModalities?(): readonly ('text' | 'image')[] | undefined
  /**
   * **目录里没有该 id** 时 `resolveModel` 该报什么思考档位。
   *
   * ⚠️ 与 `unknownModelInputModalities` **同一个形态**：各家处理不同，且不能统一。
   *
   * | 家 | 未知 id ⇒ | 理由 |
   * |---|---|---|
   * | `cline` | **仍声明 5 档** | 档位来自**产品配置**（远端不下发），与具体模型无关 ⇒ 对未知模型同样给 |
   * | `codearts` | **仍声明 2 档**（关闭/开启，**强度序**） | 本网关唯一生效的思考控制是顶层 `thinking.type`，与模型无关 |
   * | 其余 | 不声明 | 档位来自**该模型的**远端配置，未知模型无从得知 |
   *
   * ⚠️ **不提供本回调 ⇒ 未知模型不声明 reasoning**（这是多数家的正确行为：
   * 档位是「该模型的能力」，未知模型不该臆造）。
   * ⚠️ 反之若把 cline/codearts 也改成「不声明」，用户在**手填模型 id** 时会
   * 失去思考档位选择器（它们的档位本就与模型无关）。
   */
  unknownModelReasoning?(): LlmResolvedModelInfo['reasoning']
  /**
   * 异步读原始目录并**转换**成 `CatalogEntry[]`。
   *
   * ⚠️ 读取与转换**合一**而不是拆成两个回调：拆开会让「读的是远端、
   * 转换用的是兜底」这类错配成为可能。
   *
   * ⚠️ 它内部已把「远端缓存 / 兜底表 / 静态表」的选择做完（各家自己知道
   * 该用哪个），共享骨架只看到**一份已合并的 `CatalogEntry[]`**。
   */
  loadCatalog(): readonly CatalogEntry[] | Promise<readonly CatalogEntry[]>
  /**
   * **同步**全量目录（`listAllModels()` 用）。
   *
   * ## ⚠️⚠️ 为什么必须有这个回调（而不是复用 `loadCatalog`）
   *
   * `listAllModels()` 被契约要求是**同步**方法：
   * - `channel-pack-rpc` 的 `ModelCatalogSource` 要求同步，且消费者**不 await**
   *   ⇒ 改成 async 会抛 `all is not iterable`（`dead-model-store.ts` 有记录）；
   * - `provider.status` 会在**冷缓存**下直接调它并据条数算 `models.total`，
   *   判据是 `closed = total > 0 && disabled === total`。
   *
   * ⚠️ **真实缺陷史**（`aggregate-adapter.ts`）：冷缓存时 `total` 只有 1（`auto`）
   * ⇒ 用户一关掉 `auto`，`aggregate` 就被**误显示为「已关闭」**（掉进设置页的
   * 「已关闭」分组）。⇒ 本回调**不得在未加载时返回空数组**，而应返回各家的
   * **兜底表**（语义即 `this.remoteModels ?? 兜底表`）。
   *
   * ⚠️ **不要在这里写「几家」**：本节原写「这正是 **3 家**现有实现……」——
   * 那数是 `3229e3c`（迁移首批 3 家）时的快照；改造完成后该形态已扩散到**多数家**
   * （含 `buddy` / `cline` / `trae` / `zcode` 等），而注释一直没跟着更新。
   * 这类「家数」是**必然腐坏**的快照 —— 本文件另一处名单已因此写错过**两次**
   * （5 → 10 → 12），故此处**刻意不写数字**。
   * ⇒ 该契约的真正守卫是**逐 provider 的行为用例**
   * （`model-catalog-parity.spec.ts` 的 (j)：冷缓存下 `listAllModels()` 非空，
   * 用**全新适配器**跑，漏一家会点名），不是注释里的数字。
   *
   * ⚠️ 复核本条时实测踩到「测量工具骗人」：只扫 `syncCatalog` **直接**调用的
   * 那个函数体会漏掉**委托层**（`trae` 的 `syncCatalogEntries()` 体只是
   * `return this.catalogEntries()`，兜底在下一层），据此得出的家数比真值少 1。
   * 测「谁具备某语义」必须**顺着委托递归**，不能只看一层。
   *
   * ⇒ 本回调是**必需**的，不是可选优化。（设计文档说「`loadCatalog` 是唯一必须
   * 实现的回调」，那一条在同步契约下不成立 —— 本文件是更正后的口径。）
   */
  syncCatalog(): readonly CatalogEntry[]
}

export interface ModelCatalog {
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo>
  /** 「显示列表」要的全量目录（**不套黑名单**）。 */
  listAllModels(): readonly { id: string; name: string; isFree?: boolean }[]
}

export function createModelCatalog(
  deps: ModelCatalogDeps,
  config: ModelCatalogConfig,
): ModelCatalog {
  const providerId = config.product.id

  /**
   * `listAllModels()` 用的同步视图。
   *
   * ⚠️ 缓存的是 `loadCatalog()` 的**成功结果**，而**不是**「读到了远端」——
   * 因为 `loadCatalog` 内部已经做过「远端 ?? 兜底」的选择，它返回的**就是**
   * 当前该展示的全量目录。未调用过时回落到 `syncCatalog()`。
   */
  let cached: readonly CatalogEntry[] | undefined

  /** 把 `CatalogEntry` 摊成 `LlmModelInfo` 的公共字段（三态在这里落实）。 */
  function toModelInfo(entry: CatalogEntry): LlmModelInfo {
    const info: {
      provider: string
      id: string
      name: string
      description?: string
      inputModalities?: readonly ('text' | 'image')[]
    } = { provider: providerId, id: entry.id, name: entry.name }
    // ⚠️ 三态：只有 `!== undefined` 才写入 —— 写 `['text']` 会明确声明不支持图片。
    if (entry.inputModalities !== undefined) info.inputModalities = entry.inputModalities
    if (entry.description !== undefined) info.description = entry.description
    return info
  }

  return {
    async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
      // ⚠️ 无已登录账号时返回 `[]` → DSH 的 buildModelCatalog 把整个 provider
      // 分组隐藏。**必须返回空数组而不能抛错**（抛错会被归入 catalog 的
      // failures，界面上反而多一条 provider 报错）。
      if (!await providerCatalogVisible(deps.accountPool, providerId)) return []

      const all = await config.loadCatalog()
      cached = all
      const disabled = deps.accountPool?.disabledModelsFor(providerId)
      const listed = disabled === undefined || disabled.size === 0
        ? all
        : all.filter((entry) => !disabled.has(entry.id))
      return listed.map(toModelInfo)
    },

    async resolveModel(
      provider: string,
      model: string,
      _signal?: AbortSignal,
    ): Promise<LlmResolvedModelInfo> {
      const all = await config.loadCatalog()
      cached = all
      const entry = all.find((item) => item.id === model)
      // ⚠️ name 三级回退，**绝不空**（空名会让选择器出现空白项）：
      //    `bareName` → `name` → 裸 `model`。
      //
      // ⚠️⚠️ **`bareName` 优先**（不是 `name` 优先）—— 这一条与设计文档 §3.5.4.3
      //    里写的「entry.name → entry.bareName」**相反**，以本节为准。证据：
      //    - `bareName` 的**存在意义**就是「`resolveModel` 用的裸名」（见其字段注释）；
      //    - 设计文档**自己的验收表**也写「`bareName` 仅 raccoon / loomy 有；
      //      断言 `resolveModel().name` **不含 ` · x`**」；
      //    - 现有实现逐字如此：`loomy` 用 `splitLoomyRate(entry.name).name`、
      //      `raccoon` 用 `entry.name.replace(/ · .*$/, '')`；
      //    - ⚠️ 而 `minimax` **不剥**（`entry?.name ?? model`）⇒ 它**不提供**
      //      `bareName`，于是自然回退到 `name`。
      //    ⇒ 若按「name 优先」实现，loomy/raccoon 的 `resolveModel().name` 会**带上
      //      倍率后缀**，被 `loomy-adapter.spec.ts` 的「name 不带倍率」用例当场抓住
      //      （本 Task 实测：`expected 'Spark X2.5 · x0.1' to be 'Spark X2.5'`）。
      const resolved: LlmResolvedModelInfo = {
        provider,
        id: model,
        name: entry?.bareName ?? entry?.name ?? model,
      }
      if (entry !== undefined) {
        if (entry.inputModalities !== undefined) {
          resolved.inputModalities = entry.inputModalities
        }
        if (entry.description !== undefined) resolved.description = entry.description
      } else {
        // ⚠️ **未知 id**：由各家自己的判据决定（见 `unknownModelInputModalities`）。
        // 骨架**不替各家决定** —— 两个方向统一都会出真缺陷：统一成「省略」会让用户
        // 手填的未知模型从「明确不支持图片」变成「未知」（用户以为能发图）；
        // 统一成 `['text']` 则会让**故意省略**的家失去「未知」这个第三态。
        // ⇒ 家数**只在上面那个接口字段的表格里维护**，这里**刻意不抄数字**
        // （原先抄了个「10 家」并写成只有 `buddy` 省略，与那张表**互相矛盾**，
        // 正是「同一事实写多处 ⇒ 必有一处先腐坏」）。
        const unknownModalities = config.unknownModelInputModalities?.()
        if (unknownModalities !== undefined) resolved.inputModalities = unknownModalities
      }
      // ⚠️ 未知模型**不编造** context（宁可让 DSH 用默认值，也不报一个假窗口）。
      if (entry?.contextWindow !== undefined && entry.contextWindow > 0) {
        resolved.context = { contextWindow: entry.contextWindow }
      }
      // ⚠️ 非法值必须过滤：0/负数/NaN 会让 DSH 抛 INVALID_MODEL_MAX_TOKENS，
      // **整轮对话起不来**（不是降级，是崩）。
      const maxTokens = entry?.maxTokens
      if (maxTokens !== undefined && Number.isSafeInteger(maxTokens) && maxTokens > 0) {
        resolved.defaultMaxTokens = maxTokens
      }
      // ⚠️ `efforts` 非空才声明；且 `defaultEffort` **必须落在 `efforts` 内** ——
      // 指向不存在的档位会让选择器显示空白，比不给更糟（DSH 会抛
      // UNSUPPORTED_REASONING_EFFORT）。
      const reasoning = entry !== undefined ? entry.reasoning : config.unknownModelReasoning?.()
      if (reasoning !== undefined && reasoning.efforts.length > 0) {
        const defaultEffort = reasoning.defaultEffort
        const legal = defaultEffort === undefined
          || reasoning.efforts.some((effort) => effort.id === defaultEffort)
        if (legal) resolved.reasoning = reasoning
      }
      return resolved
    },

    /**
     * ⚠️ **同步**（契约要求，见 `ModelCatalogConfig.syncCatalog` 的说明）。
     * **不套黑名单** —— 设置页要能看到已关闭模型的倍率（现场反馈：
     * 「关闭的就没有显示倍率」）。
     */
    listAllModels(): readonly { id: string; name: string; isFree?: boolean }[] {
      const source = cached ?? config.syncCatalog()
      return source.map((entry) => ({
        id: entry.id,
        name: entry.name,
        ...(entry.isFree !== undefined ? { isFree: entry.isFree } : {}),
      }))
    },
  }
}
