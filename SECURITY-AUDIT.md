# 出网面安全审计（egress audit）

> 审计对象：本 fork 装机副本（当时装成 `~/.dsh/profiles/web/node_modules/dsh-our-free-model`，
> 现已作为 npm 包 **`dsh-free-model@2.1.0`** 发布，装机路径随之变为 `~/.dsh/profiles/web/node_modules/dsh-free-model`）。
> 审计日期：**2026-10-11**。审计方式：静态列出全部出网域名 + 对每个域名在本机直连握手看 TLS 证书主体。
> 复跑工具：`node scripts/egress-audit.mjs --tls`（只读、不写文件、不修改系统）。
> 2026-10-12 复核：只是**改包名**（`dsh-free-model`）与 id 引用，出网面零变化，域名表结论仍然有效；`client.js` 哈希已随改名更新。

审计时的产物指纹（要复现同期结论请先比对）：

| 文件 | sha256 |
| --- | --- |
| `index.js` | `a932bcb6bdeef608496071a60d1f9e8499997fca52765e0eb300171d8728aa57` |
| `client.js` | `13332f9b4102e5cc7125998983126df7b50cfa6a32ef5e20aefc51aca0a5e820` |
| `vendor/channel-pack/pack.js` | `2f9a8d58007fcec287c5f9be484b79adbfea8ec332bddc1ba01d52acb5877c19` |

⚠️ `pack.js` 的指纹随每次「刷新模型数据 / 移植上游修复」而变（它是构建产物）。
上面的值对应**3.0.1（2026-11-09：目录刷新加账号闸门）之后**的版本；
域名面结论未变，`scripts/egress-audit.mjs` 可随时重跑复验。
（上一版 `9255642f…` 是上游第二轮跟进后的产物。）

## 结论

**是直连对应服务提供商。** 全部业务出网都是 HTTPS 到厂商自家域名，TLS 证书主体为厂商本人；**没有第三方中转、没有回传作者服务器、没有遥测**。仅有两处外部辅助调用（模型能力元数据、出口 IP 探测），都不携带账号凭据。

## 一、15 个渠道的出网域名与证书主体

下表"证书主体"取自**本机直连握手**（域名 → TLS 证书的 Subject/Issuer），用来证明流量终点不是中间人。

| 渠道 | 出网主机 | 证书主体（实测） |
| --- | --- | --- |
| CodeArts（华为） | `codearts.huaweicloud.com`、`opengw.developer.huaweicloud.com`、`snap-access.cn-north-4.myhuaweicloud.com`、`devcloud.cn-north-4.huaweicloud.com`、`auth.huaweicloud.com`、`sts.cn-north-4.myhuaweicloud.com` | `Huawei Software Technologies Co., Ltd.`（GlobalSign） |
| CodeBuddy / WorkBuddy / Buddy（腾讯） | `copilot.tencent.com`、`www.codebuddy.cn`、`www.workbuddy.ai` | `Tencent Technology (Shenzhen) Company Limited`（DigiCert） |
| Qoder / Qoder CN（阿里） | `qoder.com`、`qoder.cn`、`gateway.qoder.com.cn`、`openapi.qoder.com.cn`、`openapi.qoder.sh`、`api2.qoder.sh`、`api2-v2.qoder.sh` | `*.qoder.com.cn` / `*.qoder.sh` / `qoder.com` |
| TRAE（字节） | `api.trae.cn`、`www.trae.cn`、`api.trae.com.cn`、`trae-api-cn.mchost.guru` | `*.trae.cn` / `*.trae.com.cn` / `*.mchost.guru`（DV 证书，不含企业名） |
| Cline | `api.cline.bot`、`app.cline.bot`、`cline.bot`；登录 `api.workos.com` | `api.cline.bot`（Google Trust Services） |
| LobsterAI（网易有道） | `lobsterai-server.youdao.com`、`lobsterai.youdao.com`、`api-overmind.youdao.com`、`pub-g1-gz.alb.ntes53.netease.com`（ALB 回源） | `网易有道信息技术（北京）有限公司` / `*.youdao.com`（ALB 主机也发 Youdao 证书） |
| Loomy（讯飞） | `loomy.xunfei.cn`、`loomyad.xunfei.cn`、`account.xfinfr.com`；微信扫码 `open.weixin.qq.com` / `long.open.weixin.qq.com` | `合肥科讯创想软件开发有限公司` / `科大讯飞股份有限公司`；微信为腾讯 |
| Raccoon（小浣熊） | `xiaohuanxiong.com`；登录页静态资源 `o.alicdn.com` | `*.xiaohuanxiong.com`；阿里 CDN `Alibaba (China) Technology Co., Ltd.` |
| MiniMax Code | `agent.minimax.cn`、`account.minimax.cn` | `*.minimax.cn`（DNSPod DV） |
| ZCode（智谱 z.ai） | `zcode.z.ai`、`api.z.ai`、`chat.z.ai` | `*.z.ai`（Sectigo DV） |
| Gemini（Google） | `daily-cloudcode-pa.googleapis.com`、`daily-cloudcode-pa.sandbox.googleapis.com`、`www.googleapis.com`、`oauth2.googleapis.com`、`accounts.google.com` | Google（**本机直连不通**，需代理才能握手；域名与用途由源码与官方 SDK 对齐） |
| Accio Work（阿里，2026-10-15 移植） | `phoenix-gw.alibaba.com`（gateway，两区域同一个）、登录页 `www.accio-ai.com`（国际）/ `zh.accio.com`（中国） | `*.alibaba.com` / `*.accio-ai.com` / `*.accio.com`，签发方 GlobalSign **OV**（已验证组织身份）—— 网关证书主体即 `*.alibaba.com`，直接证明流量终点是阿里本身而非中间人 |
| OfficeAce（华为云 ModelArts MaaS，2026-10-15 移植） | `officeace.cn-southwest-2.huaweicloud-agentarts.com`、`agentarts.cn-southwest-2.myhuaweicloud.com`、`api.modelarts-maas.com`；登录复用 `auth.huaweicloud.com` + `sts.cn-north-4.myhuaweicloud.com`（与 CodeArts 同两家） | `*.cn-southwest-2.huaweicloud-agentarts.com` / `*.cn-southwest-2.myhuaweicloud.com` / `*.modelarts-maas.com`，签发方均为 GlobalSign RSA OV（OV = 已验证组织身份，与华为云其余端点同一 CA 策略） |

## 二、仅有的外部（非厂商）调用

| 主机 | 用途 | 是否带凭据 | 在我们这份里的状态 |
| --- | --- | --- | --- |
| `https://models.dev/api.json` | Cline 车道取**模型能力元数据**（上下文/推理档位） | 否（只有 `Accept: application/json`） | 有效（Cline 在用） |
| `http://ip-api.com/json/?fields=…` | **明文 HTTP**，查出口 IP，仅供 OpenCode 车道的「测试代理」按钮 | 否 | 车道已禁用（`disableOpencode`），不会触发 |
| `http://www.gstatic.com/generate_204` | 生成的 mihomo 配置里的连通性探测 URL | 否 | 只在你启用「出口代理」时才存在，且是写入配置文本，不主动请求 |

代码注释里出现的 `github.com` / `gitee.com` / `blog.csdn.net` / `bigmodel.cn` 是**参考实现出处**，不是请求目标。

## 三、"直连"是怎么保证的

渠道出网的代理决策顺序（`vendor/channel-pack/src/channel-fetch.ts`）：

1. 目标 `127.0.0.1` / `::1` → 永不加代理；
2. **插件出口代理**（本项目「网关设置」里的出口分区）——默认关闭；
3. **环境代理** `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`——本机 dsh 进程没有任何 `*_proxy`；
4. Windows 系统代理——Linux 分支不读；
5. 否则**直连**。

因此当前渠道请求是直连厂商；桌面环境里那个 `127.0.0.1:7897`（GNOME 手动代理）**不会被渠道请求使用**。需要给 Google 系（Gemini）或 OpenCode 用车时，才需要配环境代理或启用出口。

## 四、本机暴露面

| 面 | 状态 |
| --- | --- |
| dsh 本体 | `127.0.0.1:3080`（仅回环） |
| 渠道包本地 OpenAI 网关 | `127.0.0.1:8326`，**必须带 API key**（无 key 实测 `401`）；key 文件 `~/.dsh/openai-gateway/api-key` 权限 `600` |
| 局域网中继 / 本地转发 | `18326` / `18899` **未监听**（默认关闭） |
| OAuth / 回调服务器 | 全部 `listen 127.0.0.1`（Gemini 另有一个 `::1`） |
| 浏览器半身 | 只 `fetch` 本机插件 API，不发任何外部请求 |
| 插件 HTTP 面 | 有信任围栏（Host 必须回环 + 拒跨站 + Origin/Referer 同源）；无同源头的请求实测 `401`，外部网页无法借你已登录的账号发请求 |

## 五、凭据面

- 账号 token 存在 `~/.dsh/.credentials.yaml`（`600`），由内核凭据服务保管；渠道页只拿 `credentialRef` 与**脱敏**身份（手机号形如 `130******00`），token 不回传浏览器。
- 渠道包状态 `~/.dsh/channel-pack/state.json` 与账本 `token-ledger.json` 权限 `644`，内容只有账号引用、昵称与用量，**没有密钥**（要更严可 `chmod 600`）。

## 六、打包产物与可读源码

`vendor/channel-pack/pack.js` 是 2.9 MB 打包产物，仓库里同时带可读 `src/*.ts`。用工具做域名差集：

- **产物有、源码无**：只有 `github.com`（注释里的参考仓库）与 WHATWG/W3C/IETF 规范链接（错误信息格式化用）。
- **源码有、产物无**：`www.codebuddy.cn`（仅登录页常量 `WEBSITE_HOME`，源码里未被引用，被 tree-shake）、`blog.csdn.net`/`bigmodel.cn`（注释）。

这一步只能证明**域名面**一致，加上行为套件（15 家注册、无 OpenCode 预热、RPC 失败关闭）。**不能从字节上证明 `pack.js` 与源码逐行等价**。

## 七、边界与已知风险（要知情）

1. **ZCode 会向厂商补发存活事件**：`POST https://zcode.z.ai/api/v1/event/report`，事件仅 `app_launch`、`app_daily_active`。收件方是 z.ai 本家，但这是**伪装成官方 IDE 客户端**的行为——属厂商 ToS/风控风险，不是第三方外泄。
2. **DV 证书不含企业名**的几家（Qoder 部分主机、TRAE、z.ai、MiniMax、小浣熊、Cline、models.dev）：只能靠域名归属与源码用途判断，本次未能用证书主体反证。
3. **Google 系主机直连不通**（`www.googleapis.com`、`oauth2.googleapis.com`、`accounts.google.com`、`daily-cloudcode-pa*.googleapis.com` 握手失败），需要代理；因此它们的证书主体本次未取到。
4. 插件与 dsh **同进程**、以你的用户身份拥有完整文件权限（所有 dsh 插件皆如此）。本次审的是**出网与凭据面**，不是运行沙箱。
5. 上游代码是第三方；**渠道包更新后本审计作废**，需要重跑 `node scripts/egress-audit.mjs --tls`。

## 八、怎么复跑

```bash
# 1) 静态：域名清单 + 明文 http + listen 绑定 + 产物↔源码差集（离线，秒级）
node scripts/egress-audit.mjs

# 2) 联网：对上面每个域名做 TLS 握手，打印证书主体（约 1–2 分钟）
node scripts/egress-audit.mjs --tls

# 3) 审装机副本而不是仓库
node scripts/egress-audit.mjs --root ~/.dsh/profiles/web/node_modules/dsh-free-model --tls

# 4) 运行时监听面（找有没有 0.0.0.0）
ss -ltn

# 5) 本地网关是否要钥（期望 401）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8326/v1/models
```

工具只读、不改任何文件；`--json` 可输出结构化结果供别的脚本消费。
