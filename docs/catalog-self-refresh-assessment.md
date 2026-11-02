# 模型上下架自适应评估（2026-11-02）

> **结论前置**：**可以做，但方案比上游简单得多** —— 我们已有一个现成的 30 分钟定时器
> （`REFRESH_INTERVAL_MS`，挂在 `ctx.effect` 上、带 `unref`），**目录刷新直接复用同一个
> 轮次**即可，不需要上游那套独立的 `createCatalogRefresher`。
>
> 工作量：**约 2~3 小时**（不是上游的"装配刷新器 + 9 家接线"那么大）。核心是三处小改：
> ① 各适配器把 `ensureRemoteModels` 拆出「强制重拉」入口；
> ② `index.ts` 在既有定时器里加一轮；
> ③ 补 TTL 判据防「每 30 分钟白拉一次」。
>
> ⚠️ 但**先说清一个更根本的问题**：模型上下架自适应解决的是「目录过期」，
> 而**硬编码的 `DEFAULT_MODELS` / `CONTEXT_WINDOWS` 是另一回事** —— 后者只在
> 「远端拉不到、退回兜底」时才生效。见第四节。

## 一、当前状态（实测）

| 项 | 现状 |
| --- | --- |
| codearts 是否拉远端目录 | ✅ 有（`fetchCodeArtsRemoteModels`，两来源） |
| 拉完会重拉吗 | ❌ **不会**：`if (this.remoteComplete) return` —— 一次性，**重启 DSH 才更新** |
| 有 TTL 吗 | ❌ 只有 cline / zcode 有部分 TTL 判据，其余 8 家零 |
| 有公开刷新入口吗 | ❌ 全 `private`（`ensureRemoteModels` / `loadModels`） |
| 有现成定时器吗 | ✅ **有**：`index.ts` 的 `REFRESH_INTERVAL_MS = 30 分钟`，已挂 `ctx.effect` 清理、`timer.unref()` |
| `pruned()` 会不会挡住新成员 | ✅ 不会：`withDeadModelPruning` 的 Proxy 只特殊处理 `listModels`，**其余成员原样透传并绑 this** |

⇒ **最关键的一条**：我们**不需要**上游的 `createCatalogRefresher`（那是为了给「没有定时器」的架构补），
我们的定时器已经在跑续期了，把目录刷新挂到同一轮即可 —— 且自带 `ctx.effect` 清理、`unref`、首轮立刻跑。

## 二、方案（推荐）

### 改动 1：各适配器加「强制重拉」入口（约 1.5h）

对每个有远端缓存的适配器，把现有的懒加载拆成两条路径：

```ts
// 现状
private async ensureRemoteModels(): Promise<void> {
  if (this.remoteComplete || fetchRemote === undefined) return   // ← 一次性短路
  await this.catalogGate.run(async () => { ... this.remoteComplete = ... })
}

// 改成
async refreshCatalog(): Promise<void> {   // ← 公开，供刷新器调用
  /**
   * ⚠️⚠️ **只清「已完成」标记，绝不清 `remoteModels` 数据**（2026-11-02 自查确认）。
   *
   * `ensureRemoteModels` 的失败语义已经是对的：
   * - `fetchRemote()` 抛异常 ⇒ 直接冒出，**`remoteModels` 保持旧值**（用户继续看旧目录，
   *   比退回兜底子集好）；
   * - 返回空数组 ⇒ `return false`（不落缓存、不立刻重试）。
   *
   * 若在这里顺手写 `this.remoteModels = undefined`，就会**毁掉这个好语义**：
   * 一次网络抖动 ⇒ 命名好的旧目录被清 ⇒ `listAllModels()` 落回 `DEFAULT_MODELS`
   * 兜底表（那是**子集**且**已过期**）⇒ 用户突然少看到一批模型。
   * ⇒ **只清标记**，让 `ensureRemoteModels` 自己决定何时覆盖数据。
   */
  this.remoteComplete = false
  await this.ensureRemoteModels()
}
private async ensureRemoteModels(): Promise<void> { /* 原样不动 */ }
```

⚠️ 还有一条：`listAllModels()` 是**同步**读 `remoteModels` 的缓存视图 ⇒ 刷新成功后
它立刻看到新值（因为 `ensureRemoteModels` 已重新赋值）。这是本方案比上游简单的
一个额外好处：上游要「刷新完补读一次 cached」，我们同字段天然满足。

**涉及文件**（10 个）：`llm-adapter`（codearts）、`buddy-adapter`（buddy + workbuddy 共用）、
`cline-adapter`、`lobsterai-adapter`、`loomy-adapter`、`minimax-adapter`、
`raccoon-adapter`、`trae-adapter`、`zcode-adapter`、`accio-adapter`。
（`gemini-adapter` 的目录是本地派生、零远端拉取 ⇒ 跳过。）

### 改动 2：`index.ts` 在既有定时器里加一轮（约 20 分钟）

```ts
// 现状
const refreshTimer = setInterval(() => void refreshAllCredentials(), REFRESH_INTERVAL_MS)

// 改成
const refreshTimer = setInterval(() => {
  void refreshAllCredentials()
  void refreshAllCatalogs()      // ← 新增，同一轮
}, REFRESH_INTERVAL_MS)
```

`refreshAllCatalogs()` 遍历 `modelAdapters` 调 `refreshCatalog?.()`：
- **逐 provider 顺序、单家失败不中断**（`Promise.allSettled` 语义）
- **单飞防重入**（上一轮没跑完不叠第二轮）
- 首轮**立刻跑一次**（复用既有「启动先跑一轮」的语义）

⚠️ 走 `modelAdapters` 而**不是** `ctx.llm`：后者是 DSH 公开面、不认识 `refreshCatalog`；
而 `modelAdapters` 每项都是 `pruned()` 的 Proxy，新成员自动透出（已实测确认）。

### 改动 3：TTL 判据（约 30 分钟，防白拉）

30 分钟一轮对**所有**渠道都重拉，会打出 10 家的网络请求（每轮约 10~20 个请求）。
上游用 **20 分钟 TTL + 读驱动**（`isCatalogFresh`）缓解。

我们的取舍更简单：**定时器已经是 30 分钟，直接把 `REFRESH_INTERVAL_MS` 当作 TTL**
⇒ 不需要额外 TTL 字段，一轮刷一次正好。但**要防重复**：
若用户恰好在定时器刚跑完时手动触发登录，会连拉两次 ⇒ 加一个「距上次刷新 < 5 分钟则跳过」的判据。

## 三、为什么不照搬上游的 `createCatalogRefresher`

| 上游 | 我们 |
| --- | --- |
| 需要给目录契约 `ModelCatalog` 加可选 `refresh()` | 我们的 `model-catalog.ts` 只有 **2 家**在用（accio + 自己），**11 家各有自己的缓存** |
| 装配独立刷新器 + 9 家接线 | **已有 30 分钟定时器**，加一轮即可 |
| 需要 `isCatalogFresh`（读驱动）+ TTL | 定时器周期本身就是 TTL |

⇒ 照搬会引入一套**我们不需要的**抽象（还要改 `ModelCatalog` 接口），而后者的收益为零。

## 四、⚠️ 必须说清的一件事：这**不能**替代模型表校准

用户原话是「自适应模型上下架就行，实时的话感觉可以的」。但两件事要分开：

| 问题 | 自适应能解决吗 |
| --- | --- |
| 上游**新上架**模型 → 列表里看不到 | ✅ 能（重新拉远端目录即可） |
| 上游**下架**模型 → 列表里还有（点开 404） | ✅ 能（拉不到就从目录消失） |
| 倍率/免费标记变化 | ✅ 能（目录里带） |
| **`CONTEXT_WINDOWS` 硬编码窗口错**（如 `-1017` 走 524288 兜底） | ❌ **不能** —— 那是**本地常表**，远端目录**不返回窗口元数据** |
| **远端拉不到时**退回 `DEFAULT_MODELS` 兜底表 | ❌ 不能 —— 兜底表本身过期（`GLM-5` / `glm-5.3-flash` / `deepseek-v4-pro` 已 404） |

⇒ **自适应是主路径**（覆盖 95% 场景），但**兜底表仍是过期数据**。要不要修兜底表是
**独立决定**（上游选择真机逐条测后手工改；我建议：**不动** —— 兜底表只在网络故障时生效，
而那种时候用户本来就要等网络恢复，拿一个过期但有模型的表比空列表好）。

### 已核实的三个关键前提（2026-11-02）

| 前提 | 实测结论 |
| --- | --- |
| 失败冷却会不会堵住下一轮刷新 | ✅ **不会**：`REMOTE_CATALOG_COOLDOWN_MS = 30 秒`，远小于 30 分钟周期 |
| `pruned()` Proxy 会不会挡住新方法 | ✅ **不会**：只特殊处理 `listModels`，其余成员原样透传并绑 `this` |
| 刷新失败会不会毁掉旧目录 | ⚠️ **取决于我们怎么写**：`ensureRemoteModels` 本来就在失败时保留旧值，但若 `refreshCatalog` 里顺手清 `remoteModels` 就会毁掉 ⇒ 方案已改成**只清标记** |

## 五、工作量与风险

| 项 | 估计 | 风险 |
| --- | --- | --- |
| 改动 1（10 家加 `refreshCatalog`） | 1.5h | **中**：每家缓存字段名/清法不同，容易漏清导致「看起来刷新了但列表没变」 |
| 改动 2（定时器加一轮） | 20min | 低（复用既有脚手架） |
| 改动 3（防重复） | 30min | 低 |
| 测试 | 1h | 中：需要逐家断言「refresh 后 listAllModels 真的变了」 |

**合计约 3 小时**，含 10 条守卫用例（每家的「刷新后目录真的更新」）。

## 六、建议

**建议做，且按上面的简化方案做**（不照搬上游）。理由：
1. 复用既有定时器 ⇒ 增量小、不用碰 `ModelCatalog` 接口；
2. 这是**唯一**能让「上游上/下架模型后用户不用重启」的机制，收益直接可感；
3. 风险可控：每条都能用「改目录 → 等一轮 → 列表变了」的行为用例锁住。

**但分两步交付**：先做 **codearts + buddy 系**（我们的主力渠道，验证闭环），
确认行为对后再铺其余 8 家 —— 避免一次改 10 家、出问题时难定位是哪家。
