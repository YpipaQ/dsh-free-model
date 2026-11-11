/**
 * 模型接入 — browser half, channels-only fork.
 *
 * Contributes one surface: a settings section (`settings.section`, id
 * `our-free-model`) holding the four pages this fork kept — the fourteen
 * account channels and their logins, the token dashboard and the request log
 * (both reading the pack's own ledger over the shell's `connection` RPC), and
 * the gateway page (the pack's local OpenAI gateway, this plugin's LAN relay,
 * and the egress outlet).
 *
 * The model roster, the free-lane dashboard, the EAC authorization panel, the
 * aggregate/routing/saver pages, the first-run announcement and the update
 * panels are gone with the lanes they described; nothing here shadows the stock
 * model picker, whose grouping by provider route is the tag this plugin uses.
 *
 * Data that is this plugin's own (outlet state, relay status, relay keys) is
 * read over the same-origin `/api/our-free-model/*` routes, because those are
 * served by the same host process on every kernel line this plugin targets.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides. All colour comes from theme variables so
 * the page survives a scheme switch.
 */
window.__ModuleLoader__.load({
  id: 'dsh-free-model',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'settings.ourFreeModel'
    const inject = ['slots', 'locale']

    // ── copy ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        nav: '模型接入',
        title: '模型接入',
        loading: '正在加载…',
        loadFailed: '无法连接插件后端',
        retry: '重试',
        'eac.copy': '复制链接',
        'section.egress': '出口代理（订阅分流）',
        'section.egressHint': '把推理与探测请求从代理出口发出，缓解按 IP 的频率限制。',
        'egress.enabled': '启用出口',
        'egress.modeSubscription': '订阅模式（本地 mihomo 自动测速分流）',
        'egress.url': '订阅 / 代理 URL',
        'egress.urlNew': '替换订阅地址',
        'egress.urlPlaceholder': '粘贴新的订阅 / 代理地址（留空则保持当前不变）',
        'egress.urlNone': '未设置',
        'egress.urlClear': '清除',
        'egress.urlClearWarn': '清除本机保存的订阅 / 代理地址，并关闭出口',
        'egress.mihomoPath': 'mihomo 路径',
        'egress.mihomoHint': '订阅模式留空则自动查找本机 mihomo（如 Clash Verge）。',
        'egress.apply': '应用',
        'egress.active': '出口生效中',
        'egress.inactive': '未启用',
        'egress.outlet': '当前出口',
        'egress.node': '当前最佳节点',
        'egress.measuring': '测量中…',
        'egress.direct': '关闭时请求直连发出；订阅地址按密钥对待——只存在本机设置里，不随常规接口数据下发，仅点「显示」时读取，面板默认打码。',
        'egress.error': '出口启动失败：{message}',
        'settings.failed': '设置未保存',
        'forward.show': '显示',
        'forward.hide': '隐藏',
        'forward.copy': '复制',
        'forward.copied': '已复制',
        'nav.tab.channels': '白嫖模型接入',
        'chan.title': '白嫖模型接入',
        'chan.sub': '把各家的免费额度接进来：登录一次，模型就出现在对话框的模型选择器里。凭据只写入本机凭据库，页面永远拿不到明文。',
        'chan.pack.failed': '渠道包未挂载：{reason}（免费车道与 EAC 不受影响）',
        'chan.pack.hint': '渠道包由本插件内置（vendor/channel-pack），随插件一起升级。',
        'chan.state.on': '已接入',
        'chan.group.on': '已接入',
        'chan.group.off': '未接入',
        'chan.state.off': '未接入',
        'chan.state.closed': '已关闭',
        'chan.meta.accounts': '账号',
        'chan.meta.models': '模型',
        'chan.act.add': '添加账号',
        'chan.act.refresh': '续期',
        'chan.act.test': '测试',
        'chan.act.delete': '移除',
        'chan.act.claim': '一键领取',
        'chan.fold.accounts': '账号',
        'chan.fold.models': '模型',
        'chan.noAccount': '还没有账号——点「添加账号」开始登录。',
        'chan.enabled': '启用',
        'chan.expires.never': '长效',
        'chan.disabled': '已关闭',
        'chan.login.title': '登录 {name}',
        'chan.login.step1': '在浏览器中完成登录（若没有自动打开，点下面的按钮）。',
        'chan.login.step2': '登录成功后本页会自动完成，无需复制任何东西。',
        'chan.login.open': '打开登录页',
        'chan.login.cancel': '取消',
        'chan.login.waiting': '已打开登录页，等待授权…（最长等待 10 分钟）',
        'chan.login.expired': '等待超时，请重新发起登录。',
        'chan.login.done': '已接入：{login}',
        'chan.login.failed': '登录未完成：{reason}',
        'chan.test.ok': '连接正常（{ms} ms）',
        'chan.test.failed': '测试失败：{reason}',
        'chan.claim.result': '已领取 {count} 个账号，共 {credit} 积分。',
        'chan.claim.none': '今天没有可领取的积分。',
        'chan.credit.today': '今日已领 {credit}',
        'chan.model.free': '免费额度',
        'chan.model.dead': '已下架',
        'chan.model.off': '关闭',
        'chan.model.on': '开启',
        'chan.model.enableAll': '全部开启',
        'chan.model.disableAll': '全部关闭',
        'chan.model.enabledCount': '已开启 {enabled}/{total}',
        'chan.model.allScope': '仅操作当前渠道的全部模型',
        'chan.error': '操作失败：{reason}',
        'chan.confirm.delete': '移除账号 {name}？该账号的凭据会一并删除。',
        'chan.rpc.unavailable': '宿主未提供 connection 服务，渠道操作暂不可用。',
        'nav.tab.ledger': '数据看板',
        'nav.tab.logs': '运行日志',
        'nav.tab.gateway': '网关设置',
        'chan.titleSingle': '渠道',
        'dash.title': '数据看板',
        'dash.sub': '渠道模型的 Token 消耗与推理指标：输入/输出/思考/缓存逐项统计，账号与模型双维度透视。',
        'dash.today': '今日数据',
        'dash.all': '全部历史',
        'dash.refresh': '刷新',
        'dash.kpiToday': '今日消耗 Token',
        'dash.kpiScopeAll': '范围内消耗 Token',
        'dash.kpiCumulative': '累计消耗 Token',
        'dash.kpiSpeed': '平均生成速度',
        'dash.kpiCache': '上下文缓存命中率',
        'dash.kpiRequests': '请求数 & 成功率',
        'dash.input': '输入',
        'dash.output': '输出',
        'dash.reasoning': '思考',
        'dash.ttft': '首字',
        'dash.cacheTokens': '缓存命中',
        'dash.successRate': '成功率',
        'dash.failed': '失败',
        'dash.recentTitle': '总览 · 最近请求',
        'dash.recentHint': '来自渠道包的逐请求账本：时间、账号、首字延迟、生成速度与 Token 细分。',
        'dash.empty': '暂无数据——通过渠道模型发起一次对话后，这里就会开始记录。',
        'dash.accountsTitle': '各账号用量透视与模型消耗分布',
        'dash.accountsHint': '按账号汇总请求数与 Token 细分，附调用量最高的模型。',
        'dash.modelsTitle': '模型性能指标与用量一览',
        'dash.modelsHint': '融合首字延迟、生成速度与 Token 统计 · 用量占比按消耗 Token 计算。',
        'log.time': '时间',
        'log.model': '模型',
        'log.account': '账号',
        'log.via': '通道',
        'log.viaDirect': '对话',
        'log.viaGateway': '网关',
        'log.result': '结果',
        'log.ok': '成功',
        'log.failed': '失败',
        'log.duration': '耗时',
        'log.ttft': '首字',
        'log.speed': '速度',
        'log.input': '输入',
        'log.output': '输出',
        'log.reasoning': '思考',
        'log.cache': '缓存',
        'log.total': '总 token',
        'log.requests': '请求数',
        'log.inputSlash': '输入 / 输出 / 思考',
        'log.cacheHit': '缓存命中率',
        'log.share': '用量占比',
        'log.modelMix': '调用的模型分布',
        'log.unattributed': '未归属',
        'logs.title': '运行日志',
        'logs.sub': '逐条请求明细：结果、耗时、首字、速度与 Token 细分；悬停失败行可看原因。',
        'logs.auto': '每 10 秒自动刷新',
        'logs.count': '共 {total} 条 · 本页 {shown} 条',
        'logs.empty': '还没有请求记录。',
        'logs.page': '第 {page} 页 / 共 {pages} 页',
        'logs.windowNote': '逐条日志保留最近窗口；历史只保留按日聚合（约 90 天），数据看板的「全部历史」即来源于此。',
        'gw.title': '网关设置',
        'gw.sub': '把渠道模型以 OpenAI 兼容接口发给本机与局域网工具：端点、密钥与转发端口都在这里。',
        'gw.gatewayTitle': '渠道模型网关（OpenAI 兼容）',
        'gw.gatewayHint': '覆盖全部已接入渠道；Chat Completions 与 Responses 两套接口同时可用。',
        'gw.running': '运行中',
        'gw.stopped': '未运行',
        'gw.envBlocked': '已被环境变量停用',
        'gw.switch': '启用网关',
        'gw.endpoint': '端点',
        'gw.key': 'API Key',
        'gw.show': '显示',
        'gw.hide': '隐藏',
        'gw.keyNote': '明文凭据：只用于客户端配置，请勿外发。',
        'gw.keyNone': '尚未生成',
        'gw.keyNoneHint': '启用一次网关即会自动生成密钥。',
        'gw.models': '可转发模型',
        'gw.portNote': '端口可用环境变量 DSH_OPENAI_GATEWAY_PORT 调整。',
        'gw.relayTitle': '局域网转发（本插件中继）',
        'gw.relayHint': '把网关再暴露到一个可选的地址与端口：调用方用下面的中继密钥，网关自身只监听本机。',
        'gw.relaySwitch': '启用局域网转发',
        'gw.relayBind': '监听地址',
        'gw.bindLocal': '仅本机（127.0.0.1）',
        'gw.bindLan': '局域网（0.0.0.0）',
        'gw.relayPort': '端口',
        'gw.relayUrl': 'Base URL',
        'gw.relayKey': '中继密钥',
        'gw.rotate': '轮换',
        'gw.relayNote': '中继只放行模型接口（/v1/*），并要求携带中继密钥；局域网绑定意味着同网段的设备都能访问到这个端口。',
        'chan.credits.left': '剩余积分',
        'chan.credits.tokens': '剩余 Token',
        'chan.credits.dollars': '剩余余额（USD）',
        'chan.credits.quota': '剩余配额',
        'chan.credits.loaded': '已查询 {count} 个账号',
        'chan.credits.refresh': '刷新余额',
        'chan.credits.loading': '余额查询中…',
        'chan.credits.failed': '余额查询失败：{reason}',
        'chan.credits.partial': '{count} 个账号未能查询余额，请展开账号查看原因并重试。',
        'chan.credits.unavailable': '未返回余额数据',
        'chan.claim.failed': '领取失败：{reason}',
        'chan.auto.title': '每日自动签到',
        'chan.auto.running': '签到进行中…',
        'chan.auto.ran': '今日已自动签到',
        'chan.auto.off': '今日尚未签到',
        'chan.auto.last': '上次结果：{result}',
      },
      en: {
        nav: 'Model Access',
        title: 'Model Access',
        loading: 'Loading…',
        loadFailed: 'Cannot reach the plugin backend',
        retry: 'Retry',
        'section.egress': 'Egress outlet (subscription routing)',
        'section.egressHint': 'Send inference and probe traffic through a proxy outlet to ease per-IP rate limits.',
        'egress.enabled': 'Enable outlet',
        'egress.modeSubscription': 'Subscription mode (local mihomo picks the fastest node)',
        'egress.url': 'Subscription / proxy URL',
        'egress.urlNew': 'Replace the address',
        'egress.urlPlaceholder': 'Paste a new subscription / proxy URL (leave empty to keep the current one)',
        'egress.urlNone': 'not set',
        'egress.urlClear': 'Clear',
        'egress.urlClearWarn': 'Clear the stored subscription / proxy address and turn the outlet off',
        'egress.mihomoPath': 'mihomo path',
        'egress.mihomoHint': 'Leave empty in subscription mode to auto-locate a local mihomo (e.g. Clash Verge).',
        'egress.apply': 'Apply',
        'egress.active': 'Outlet active',
        'egress.inactive': 'Not enabled',
        'egress.outlet': 'Current outlet',
        'egress.node': 'Best node',
        'egress.measuring': 'measuring…',
        'egress.direct': 'While off, requests go direct; the address is treated as a credential — kept in this machine\'s settings only, never sent down with the regular API payloads, readable only through the reveal button, masked here by default.',
        'egress.error': 'The outlet failed to start: {message}',
        'eac.copy': 'Copy link',
        'settings.failed': 'Settings not saved',
        'forward.show': 'Show',
        'forward.hide': 'Hide',
        'forward.copy': 'Copy',
        'forward.copied': 'Copied',
        'nav.tab.channels': 'Free channels',
        'chan.title': 'Free channel access',
        'chan.sub': 'Bring each vendor\'s free quota in: sign in once and its models appear in the composer\'s model picker. Credentials are written to the local credential store only — this page never sees them.',
        'chan.pack.failed': 'Channel pack not mounted: {reason} (the free and EAC lanes are unaffected)',
        'chan.pack.hint': 'The pack ships inside this plugin (vendor/channel-pack) and upgrades with it.',
        'chan.state.on': 'Connected',
        'chan.group.on': 'Connected',
        'chan.group.off': 'Not connected',
        'chan.state.off': 'Not connected',
        'chan.state.closed': 'Turned off',
        'chan.meta.accounts': 'Accounts',
        'chan.meta.models': 'Models',
        'chan.act.add': 'Add account',
        'chan.act.refresh': 'Refresh',
        'chan.act.test': 'Test',
        'chan.act.delete': 'Remove',
        'chan.act.claim': 'Claim daily',
        'chan.fold.accounts': 'Accounts',
        'chan.fold.models': 'Models',
        'chan.noAccount': 'No account yet — press “Add account” to sign in.',
        'chan.enabled': 'Enabled',
        'chan.expires.never': 'Long-lived',
        'chan.disabled': 'Disabled',
        'chan.login.title': 'Sign in to {name}',
        'chan.login.step1': 'Finish the sign-in in your browser (if it did not open, use the button below).',
        'chan.login.step2': 'This page completes by itself once the browser flow does — nothing to copy.',
        'chan.login.open': 'Open sign-in page',
        'chan.login.cancel': 'Cancel',
        'chan.login.waiting': 'Sign-in page opened; waiting for authorization… (up to 10 minutes)',
        'chan.login.expired': 'Timed out — please start the sign-in again.',
        'chan.login.done': 'Connected: {login}',
        'chan.login.failed': 'Sign-in did not complete: {reason}',
        'chan.test.ok': 'Connection healthy ({ms} ms)',
        'chan.test.failed': 'Test failed: {reason}',
        'chan.claim.result': 'Claimed for {count} account(s), {credit} credits in total.',
        'chan.claim.none': 'Nothing to claim today.',
        'chan.credit.today': '{credit} claimed today',
        'chan.model.free': 'Free quota',
        'chan.model.dead': 'Retired',
        'chan.model.off': 'Hide',
        'chan.model.on': 'Show',
        'chan.model.enableAll': 'Show all',
        'chan.model.disableAll': 'Hide all',
        'chan.model.enabledCount': 'Shown {enabled}/{total}',
        'chan.model.allScope': 'Apply to all models in this channel only',
        'chan.error': 'Action failed: {reason}',
        'chan.confirm.delete': 'Remove account {name}? Its credential is deleted with it.',
        'chan.rpc.unavailable': 'This host exposes no connection service, so channel actions are unavailable.',
        'nav.tab.ledger': 'Dashboard',
        'nav.tab.logs': 'Request log',
        'nav.tab.gateway': 'Gateway',
        'chan.titleSingle': 'Channel',
        'dash.title': 'Usage dashboard',
        'dash.sub': 'Token spend and inference metrics for the channel models: input/output/reasoning/cache, pivoted by account and by model.',
        'dash.today': 'Today',
        'dash.all': 'All time',
        'dash.refresh': 'Refresh',
        'dash.kpiToday': 'Tokens today',
        'dash.kpiScopeAll': 'Tokens in scope',
        'dash.kpiCumulative': 'Tokens all time',
        'dash.kpiSpeed': 'Average speed',
        'dash.kpiCache': 'Context cache hit rate',
        'dash.kpiRequests': 'Requests & success rate',
        'dash.input': 'Input',
        'dash.output': 'Output',
        'dash.reasoning': 'Reasoning',
        'dash.ttft': 'TTFT',
        'dash.cacheTokens': 'Cache hits',
        'dash.successRate': 'Success',
        'dash.failed': 'Failed',
        'dash.recentTitle': 'Overview · Recent requests',
        'dash.recentHint': 'From the pack\'s per-request ledger: time, account, TTFT, speed and the token breakdown.',
        'dash.empty': 'Nothing yet — one conversation through a channel model starts the record.',
        'dash.accountsTitle': 'Per-account usage & model mix',
        'dash.accountsHint': 'Requests and token breakdown per account, with the most-used models.',
        'dash.modelsTitle': 'Model performance & usage',
        'dash.modelsHint': 'TTFT, speed and token statistics per model · usage share is by tokens spent.',
        'log.time': 'Time',
        'log.model': 'Model',
        'log.account': 'Account',
        'log.via': 'Via',
        'log.viaDirect': 'Chat',
        'log.viaGateway': 'Gateway',
        'log.result': 'Result',
        'log.ok': 'OK',
        'log.failed': 'Failed',
        'log.duration': 'Duration',
        'log.ttft': 'TTFT',
        'log.speed': 'Speed',
        'log.input': 'Input',
        'log.output': 'Output',
        'log.reasoning': 'Reasoning',
        'log.cache': 'Cache',
        'log.total': 'Total tok',
        'log.requests': 'Requests',
        'log.inputSlash': 'Input / Output / Reasoning',
        'log.cacheHit': 'Cache hit',
        'log.share': 'Share',
        'log.modelMix': 'Model mix',
        'log.unattributed': 'Unattributed',
        'logs.title': 'Request log',
        'logs.sub': 'Every request in detail: result, duration, TTFT, speed and the token breakdown; hover a failed row for the reason.',
        'logs.auto': 'Refresh every 10 s',
        'logs.count': '{total} entries · {shown} on this page',
        'logs.empty': 'No requests recorded yet.',
        'logs.page': 'Page {page} of {pages}',
        'logs.windowNote': 'Per-request rows cover a recent window only; history is kept as daily aggregates (~90 days) — the dashboard\'s "All time" reads those.',
        'gw.title': 'Gateway settings',
        'gw.sub': 'Serve the channel models over an OpenAI-compatible API to this machine and the LAN: endpoint, key and relay port live here.',
        'gw.gatewayTitle': 'Channel gateway (OpenAI compatible)',
        'gw.gatewayHint': 'Covers every connected channel; Chat Completions and Responses are both served.',
        'gw.running': 'Running',
        'gw.stopped': 'Not running',
        'gw.envBlocked': 'Disabled by environment',
        'gw.switch': 'Enable gateway',
        'gw.endpoint': 'Endpoint',
        'gw.key': 'API Key',
        'gw.show': 'Show',
        'gw.hide': 'Hide',
        'gw.keyNote': 'A plaintext credential for client configuration — handle with care.',
        'gw.keyNone': 'Not generated yet',
        'gw.keyNoneHint': 'Enabling the gateway once mints a key automatically.',
        'gw.models': 'Servable models',
        'gw.portNote': 'The port can be moved with the DSH_OPENAI_GATEWAY_PORT environment variable.',
        'gw.relayTitle': 'LAN relay (this plugin\'s)',
        'gw.relayHint': 'Re-expose the gateway on an address and port you choose: callers use the relay key below, and the gateway itself stays on the loopback.',
        'gw.relaySwitch': 'Enable LAN relay',
        'gw.relayBind': 'Bind address',
        'gw.bindLocal': 'This machine only (127.0.0.1)',
        'gw.bindLan': 'LAN (0.0.0.0)',
        'gw.relayPort': 'Port',
        'gw.relayUrl': 'Base URL',
        'gw.relayKey': 'Relay key',
        'gw.rotate': 'Rotate',
        'gw.relayNote': 'The relay forwards only the model routes (/v1/*) and demands the relay key; binding to the LAN means every device on the network can reach that port.',
        'chan.credits.left': 'Credits left',
        'chan.credits.tokens': 'Tokens left',
        'chan.credits.dollars': 'Balance left (USD)',
        'chan.credits.quota': 'Quota left',
        'chan.credits.loaded': '{count} accounts queried',
        'chan.credits.refresh': 'Refresh balance',
        'chan.credits.loading': 'Querying balance…',
        'chan.credits.failed': 'Balance query failed: {reason}',
        'chan.credits.partial': 'Could not query {count} accounts. Expand accounts to see the reasons and retry.',
        'chan.credits.unavailable': 'No balance data returned',
        'chan.claim.failed': 'Claim failed: {reason}',
        'chan.auto.title': 'Daily auto check-in',
        'chan.auto.running': 'Check-in running…',
        'chan.auto.ran': 'Checked in today',
        'chan.auto.off': 'Not checked in today',
        'chan.auto.last': 'Last result: {result}',
      },
    }

    // ── styles ────────────────────────────────────────────────────────────────
    // Two theme variables are not defined by every shell — measured in the web
    // shell this plugin ships against, `--dsw-alias-state-warning-primary` and
    // `--dsw-alias-label-on-accent` resolve to nothing. A declaration whose
    // var() is invalid at computed-value time is dropped *whole*, so without a
    // fallback every warning-coloured surface disappears: the pool tank's water
    // (level "busy") rendered as an empty box, the region-limited badge lost its
    // colour, callouts lost their border. Every use of those two names carries a
    // fallback for exactly that reason.
    const CSS = `
/* ═══════════════════════════════════════════════════════════════════════
   模型接入 — visual system
   统一令牌：所有色值取自宿主 --dsw-alias-* 变量，昼夜由宿主切换。
   层级约定：layer-3 凹槽/页面底 · layer-2 面板 · layer-1 浮起元素。
   动效约定：transform/opacity 优先；常规 150–300ms、覆盖层 300–400ms。
   ═══════════════════════════════════════════════════════════════════════ */
.ofm_root{--ease-instrument:cubic-bezier(.16,1,.3,1);--ease-settle:cubic-bezier(.34,1.4,.4,1);--gap:14px;display:flex;flex-direction:column;gap:calc(var(--gap)*1.4);max-width:1080px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);-webkit-font-smoothing:antialiased}
.ofm_root::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.022;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E")}
.ofm_root>*{position:relative;z-index:1}
.ofm_root *{box-sizing:border-box}
.ofm_root ::-webkit-scrollbar{width:10px;height:10px}
.ofm_root ::-webkit-scrollbar-track{background:transparent}
.ofm_root ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 32%,transparent);border-radius:99px;border:2.5px solid transparent;background-clip:padding-box}
.ofm_root ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 52%,transparent);background-clip:padding-box;border:2.5px solid transparent}
.ofm_root{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 32%,transparent) transparent}

.ofm_root ::selection{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}
/* ── 键盘可达性：只给键盘聚焦画聚焦环，鼠标点击不出现 ─────────────────── */
.ofm_root :focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 78%,transparent);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent)}
/* ══ 页头 hero ═════════════════════════════════════════════════════════ */
.ofm_hero{position:relative;display:flex;flex-direction:column;gap:14px;padding:22px 24px;border-radius:20px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);background:linear-gradient(165deg,color-mix(in srgb,var(--dsw-alias-bg-layer-3) 88%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent));overflow:hidden}
.ofm_hero::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 150% at 12% -20%,color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent),transparent 58%),radial-gradient(90% 120% at 88% 130%,color-mix(in srgb,var(--dsw-alias-state-success-primary) 7%,transparent),transparent 60%)}
.ofm_hero>*{position:relative}
.ofm_pagehead{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
.ofm_pagetitle{display:flex;flex-direction:column;gap:6px;min-width:0}
.ofm_pagetitle h2{margin:0;font-size:23px;font-weight:760;letter-spacing:-.6px;line-height:1.2;background:linear-gradient(120deg,var(--dsw-alias-label-primary) 20%,color-mix(in srgb,var(--dsw-alias-label-primary) 55%,var(--dsw-alias-state-business-primary)));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.ofm_pagesub{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);max-width:70ch}
.ofm_pagehead .ofm_pills{margin-left:auto}
.ofm_pills{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.ofm_pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 4%);font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;transition:border-color .16s ease,color .16s ease}
.ofm_pill.strong{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.ofm_dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}

.ofm_dot.ok{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent);}
.ofm_dot.warn{background:var(--dsw-alias-state-warning-primary,#f0a441);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 18%,transparent)}
.ofm_dot.err{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}
/* ══ 区块与分节 ════════════════════════════════════════════════════════ */
.ofm_sec{display:flex;flex-direction:column;gap:10px}
.ofm_sechead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ofm_sec_title{font-size:14px;font-weight:680;letter-spacing:-.2px}
.ofm_sec_hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-left:auto}
.ofm_badge{margin-left:auto;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 60%,transparent);white-space:nowrap}
.ofm_badge.available{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.ofm_badge.region-blocked{color:var(--dsw-alias-state-warning-primary,#f0a441);border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 10%,transparent)}
.ofm_badge.throttled,.ofm_badge.unavailable{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.ofm_badge.unknown{color:var(--dsw-alias-label-tertiary)}
.ofm_id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ofm_note{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
/* ══ 面板 ══════════════════════════════════════════════════════════════ */
.ofm_panel{padding:16px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 5%),0 2px 6px rgb(0 0 0 / 4%);display:flex;flex-direction:column;gap:12px}
.ofm_paneltitle{font-size:12px;font-weight:680;letter-spacing:.2px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px}
.ofm_paneltitle .ofm_sec_hint{font-weight:400;letter-spacing:0}
.ofm_row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
/* ══ 分段选择器 ════════════════════════════════════════════════════════ */
.ofm_seg{display:inline-flex;padding:3px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);gap:2px;box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%)}
.ofm_seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;font-weight:550;padding:3px 11px;border-radius:8px;cursor:pointer;transition:color .16s ease,background .16s ease,box-shadow .16s ease}
.ofm_seg button:hover{color:var(--dsw-alias-label-primary)}
.ofm_seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgb(0 0 0 / 12%),inset 0 1px 0 rgb(255 255 255 / 6%)}
/* ══ 数据表格 ══════════════════════════════════════════════════════════ */
.ofm_table{width:100%;min-width:760px;border-collapse:collapse;font-size:11.5px}
.ofm_tablewrap{overflow-x:auto;max-width:100%}
.ofm_table th{text-align:left;font-weight:560;font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);padding:0 10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.ofm_table td{padding:7px 10px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 62%,transparent);font-variant-numeric:tabular-nums}
.ofm_table td:first-child{font-weight:600}
.ofm_table tbody tr{transition:background .15s ease}
.ofm_table tbody tr:hover td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,transparent)}
.ofm_table tr:last-child td{border-bottom:0}
.ofm_num{text-align:right}
/* ══ 按钮（分层状态） ══════════════════════════════════════════════════ */
.ofm_btn{font:inherit;font-size:12px;font-weight:580;padding:6px 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 84%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 5%),0 1px 2px rgb(0 0 0 / 6%);color:var(--dsw-alias-label-primary);cursor:pointer;transition:transform .18s var(--ease-instrument),border-color .2s var(--ease-instrument),background .2s var(--ease-instrument),box-shadow .22s var(--ease-instrument),opacity .16s ease}
.ofm_btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 62%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,var(--dsw-alias-bg-layer-3));transform:translateY(-1px);box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%),0 3px 8px rgb(0 0 0 / 9%)}
.ofm_btn:active:not(:disabled){transform:scale(.985);transition-duration:.1s;box-shadow:inset 0 1px 0 rgb(255 255 255 / 4%)}
.ofm_btn:disabled{opacity:.45;cursor:default;box-shadow:none;transform:none}
.ofm_btn.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 88%,#fff),var(--dsw-alias-state-business-primary));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 82%,#000);color:var(--dsw-alias-label-on-accent,#fff);box-shadow:inset 0 1px 0 rgb(255 255 255 / 18%),0 2px 8px color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,transparent)}
.ofm_btn.primary:hover:not(:disabled){background:linear-gradient(180deg,var(--dsw-alias-state-business-primary),color-mix(in srgb,var(--dsw-alias-state-business-primary) 88%,#000));border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 1px 0 rgb(255 255 255 / 20%),0 4px 14px color-mix(in srgb,var(--dsw-alias-state-business-primary) 42%,transparent)}
.ofm_btn.ghost{background:transparent;box-shadow:none;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.ofm_btn.ghost:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,transparent);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.ofm_minibtn{font:inherit;font-size:11px;font-weight:540;padding:3px 9px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 85%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 70%,transparent);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:transform .12s ease,border-color .16s ease,color .16s ease,background .16s ease,opacity .16s ease}
.ofm_minibtn:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,transparent);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent);transform:translateY(-1px)}
.ofm_minibtn:active:not(:disabled){transform:scale(.96)}
.ofm_minibtn:disabled{opacity:.45;cursor:default;transform:none}
.ofm_minibtn.danger:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,transparent);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
/* ══ 表单 ══════════════════════════════════════════════════════════════ */
.ofm_field{display:flex;flex-direction:column;gap:4px;min-width:120px}
.ofm_field>span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ofm_input{font:inherit;font-size:12px;padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%);color:var(--dsw-alias-label-primary);min-width:0;width:100%;transition:border-color .16s ease,box-shadow .16s ease}
.ofm_input::placeholder{color:var(--dsw-alias-label-tertiary)}
.ofm_input:hover{border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 60%,var(--dsw-alias-label-tertiary))}
.ofm_input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent)}
/* ══ 开关（spring 滑块） ═══════════════════════════════════════════════ */
.ofm_switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
.ofm_switch i{width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);box-shadow:inset 0 1px 3px rgb(0 0 0 / 8%);position:relative;transition:background .2s ease,border-color .2s ease,box-shadow .2s ease;flex:none}
.ofm_switch:hover i{filter:brightness(1.05)}
.ofm_switch[aria-checked="true"]:hover i{filter:brightness(1.08)}
.ofm_switch i::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);box-shadow:0 1px 3px rgb(0 0 0 / 22%);transition:transform .26s cubic-bezier(.34,1.3,.64,1),background .2s ease,width .16s ease}
.ofm_switch:active i::after{width:17px}
.ofm_switch[aria-checked="true"] i{background:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 85%,#000);box-shadow:inset 0 1px 3px rgb(0 0 0 / 12%)}
.ofm_switch[aria-checked="true"] i::after{transform:translateX(16px);background:#fff}
.ofm_switch[aria-checked="true"]:active i::after{transform:translateX(13px)}
.ofm_switch:focus-visible i{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent)}
.ofm_mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;padding:7px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);overflow-x:auto;white-space:pre;color:var(--dsw-alias-label-secondary)}
/* ══ 提示条 ════════════════════════════════════════════════════════════ */
.ofm_callout{display:flex;gap:9px;padding:10px 12px;border-radius:11px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 9%,transparent);font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.ofm_error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}
/* ══ 公告（首次引导） ══════════════════════════════════════════════════ */
/* The onboarding slot is mounted inside the collapsed sidebar foot of the shell,
   so a card that stays in flow inherits a 55 px-wide, overflow-hidden column. The
   scrim is therefore fixed to the viewport; the shell sets no transform, filter
   or contain on any ancestor, so nothing re-anchors it. Mask colour, blur and
   z-index mirror the Modal layer of the shell so this reads as first-party. */
.ofm_scrim{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:var(--dsw-alias-bg-mask-1, rgb(0 0 0 / 32%));}

/* ══ Toast（fixed 到视口，浮在所有层之上） ════════════════════════════ */
.ofm_toasts{position:fixed;right:18px;bottom:18px;z-index:1200;display:flex;flex-direction:column;gap:10px;max-width:min(380px,calc(100vw - 36px));font-family:inherit}
.ofm_toast{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px 14px 12px 16px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 94%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%),0 14px 40px rgb(0 0 0 / 26%);font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow:hidden}
.ofm_toast{transform-origin:bottom right;will-change:transform}
.ofm_toast::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--dsw-alias-state-business-primary)}
.ofm_toast.warn::before{background:var(--dsw-alias-state-warning-primary,#f0a441)}
.ofm_toast.urgent::before{background:var(--dsw-alias-state-error-primary)}
.ofm_toast.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 42%,var(--dsw-alias-border-l2))}
.ofm_toast.urgent{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l2))}
.ofm_toast .ofm_toasttitle{font-weight:660;font-size:12.5px;display:flex;align-items:center;gap:7px}
.ofm_toast .ofm_toastbody{color:var(--dsw-alias-label-secondary);max-height:180px;overflow:auto;overflow-wrap:anywhere}
.ofm_toast .ofm_toastbody p{margin:0 0 5px}
.ofm_toast .ofm_toastbody p:last-child{margin-bottom:0}
.ofm_toast .ofm_toastbody img{max-width:100%}
.ofm_toastactions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.ofm_toastclose{margin-left:auto;background:transparent;border:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:13px;padding:0 2px;transition:color .14s ease}
.ofm_toastclose:hover{color:var(--dsw-alias-label-primary)}
/* ══ 模态 ══════════════════════════════════════════════════════════════ */
.ofm_modal{width:min(520px,92vw);max-height:min(80vh,600px);border-radius:18px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 95%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 8%),0 28px 80px rgb(0 0 0 / 42%);display:flex;flex-direction:column;overflow:hidden;}
.ofm_modalhead{padding:17px 20px 11px;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:720;letter-spacing:-.2px}
.ofm_modalbody{padding:4px 20px 16px;overflow:auto;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.ofm_modalbody p{margin:0 0 6px}
.ofm_modalfoot{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 72%,transparent)}
@media (max-width:720px){.ofm_sec_hint{margin-left:0;width:100%}.ofm_pills{margin-left:0;width:100%}}

/* ══ 四页外壳：导航 · 页过渡 ═══════════════════════════════════════════ */
.ofm_shell{position:relative;display:flex;flex-direction:column;gap:18px;max-width:1120px;isolation:isolate}

.ofm_nav{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:16px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 62%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%),0 8px 26px rgb(0 0 0 / 10%)}
.ofm_navbrand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:14px;letter-spacing:-.2px;white-space:nowrap}
.ofm_navmark{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;flex:none;background:linear-gradient(145deg,var(--dsw-alias-state-business-primary),color-mix(in srgb,var(--dsw-alias-state-business-primary) 42%,#3ECFA0));box-shadow:0 4px 12px color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent),inset 0 1px 0 rgb(255 255 255 / 22%)}
.ofm_navmark svg{width:16px;height:16px;fill:#fff}
.ofm_tabs{position:relative;grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:2px;padding:3px;border-radius:13px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 62%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 4%)}
.ofm_tabglider{position:absolute;top:0;left:0;border-radius:10px;background:linear-gradient(150deg,color-mix(in srgb,var(--dsw-alias-bg-layer-3) 92%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,transparent));box-shadow:0 3px 10px rgb(0 0 0 / 14%),inset 0 1px 0 rgb(255 255 255 / 9%);transition:transform .34s cubic-bezier(.22,.61,.36,1),width .34s cubic-bezier(.22,.61,.36,1),height .34s cubic-bezier(.22,.61,.36,1);pointer-events:none}
.ofm_tab{position:relative;z-index:1;font:inherit;font-size:12px;font-weight:600;padding:6px 13px;border-radius:10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:color .2s ease}
.ofm_tab[data-on="true"]{color:var(--dsw-alias-label-primary)}
.ofm_tab:hover{color:var(--dsw-alias-label-primary)}
.ofm_tab .ofm_tabnum{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-tertiary);margin-left:6px;font-size:11px}
.ofm_navspacer{display:none}
.ofm_page{display:flex;flex-direction:column;gap:20px;}
/* ── 玻璃表面：半透明叠层，大块面与小卡片共用一套底色 ─────────────── */
.ofm_glass{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 68%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%),0 12px 34px rgb(0 0 0 / 9%)}.ofm_root .ofm_hero,.ofm_root .ofm_panel,.ofm_root .ofm_modal{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%),0 14px 40px rgb(0 0 0 / 10%)}
/* ══ 渠道接入页 ════════════════════════════════════════════════════════ */
.ofm_chanwrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
/* 渠道分组标题：已接入 / 未接入。⚠️ 必须 grid-column:1/-1 横跨整行 ——
   否则它会变成一个 330px 的格子（把第一张卡挤到第二列）。 */
.ofm_chargroup{grid-column:1/-1;display:flex;align-items:center;gap:9px;margin:2px 0 -4px;font-size:12px;font-weight:650;letter-spacing:.02em;color:var(--dsw-alias-text-l3)}
.ofm_chargroup:not(:first-child){margin-top:12px}
.ofm_chargroup::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l2),transparent)}
.ofm_chargroupn{font-variant-numeric:tabular-nums;font-weight:600;opacity:.72}
.ofm_chargroupdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#12b76a);flex:none}
.ofm_chargroupdot.off{background:var(--dsw-alias-text-l3);opacity:.5}
.ofm_chan{position:relative;display:flex;flex-direction:column;gap:12px;padding:16px 17px 15px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 78%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 5%),0 1px 2px rgb(0 0 0 / 5%);overflow:hidden;transition:transform .22s cubic-bezier(.32,.72,0,1),box-shadow .24s ease,border-color .2s ease}
.ofm_chan::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--chan-accent,var(--dsw-alias-state-business-primary)),transparent 78%);opacity:.95}
.ofm_chan:hover{transform:translateY(-3px);box-shadow:inset 0 1px 0 rgb(255 255 255 / 8%),0 18px 40px rgb(0 0 0 / 15%);border-color:color-mix(in srgb,var(--chan-accent,var(--dsw-alias-state-business-primary)) 55%,transparent)}
.ofm_chan.off{opacity:.62}
.ofm_chanhead{display:flex;align-items:center;gap:11px}
.ofm_chanlogo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;font-weight:800;font-size:13px;color:#fff;letter-spacing:-.3px;background:linear-gradient(150deg,var(--chan-accent,var(--dsw-alias-state-business-primary)),color-mix(in srgb,var(--chan-accent,var(--dsw-alias-state-business-primary)) 45%,#101828));box-shadow:0 6px 16px color-mix(in srgb,var(--chan-accent,var(--dsw-alias-state-business-primary)) 34%,transparent),inset 0 1px 0 rgb(255 255 255 / 22%)}
.ofm_chan:hover .ofm_chanlogo{transform:scale(1.06) rotate(-3deg);transition:transform .35s cubic-bezier(.34,1.56,.64,1)}
.ofm_chanlogo{transition:transform .35s cubic-bezier(.34,1.56,.64,1)}
.ofm_chanid{display:flex;flex-direction:column;gap:2px;min-width:0}
.ofm_chanid b{font-size:14px;font-weight:700;letter-spacing:-.2px}
.ofm_chanid span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ofm_chanstate{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);padding:3px 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 90%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent);white-space:nowrap}
.ofm_chanmeta{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.ofm_chanmeta b{color:var(--dsw-alias-label-secondary);font-weight:650;font-variant-numeric:tabular-nums}
.ofm_chanacts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ofm_acctlist{display:flex;flex-direction:column;gap:6px}
.ofm_acct{display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:7px 10px;border-radius:11px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 82%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 62%,transparent);font-size:12px;transition:border-color .16s ease,background .16s ease}
.ofm_acct:hover{border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent)}
.ofm_acct.pending{border-style:dashed}
.ofm_acctname{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
.ofm_acctmeta{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ofm_balanceerror{flex-basis:100%;overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary);font-size:11px}
.ofm_acctacts{margin-left:auto;display:flex;gap:5px;flex-wrap:wrap}
.ofm_modellist{display:flex;flex-direction:column;gap:4px;max-height:238px;overflow:auto;padding-right:2px}
.ofm_modelrow{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);font-size:11.5px;transition:background .15s ease}
.ofm_modelrow:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 85%,transparent)}
.ofm_modelrow.off{opacity:.5}
.ofm_modelrow .ofm_id{flex:1;min-width:0}
.ofm_tagpill{font-size:10px;font-weight:560;padding:1px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 90%,transparent);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ofm_tagpill.free{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}
.ofm_tagpill.dead{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.ofm_chanfold{border-top:1px dashed color-mix(in srgb,var(--dsw-alias-border-l1) 85%,transparent);padding-top:10px;display:flex;flex-direction:column;gap:8px}
.ofm_foldtoggle{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:transparent;border:0;cursor:pointer;font-family:inherit;padding:0;transition:color .15s ease}
.ofm_foldtoggle svg{transition:transform .3s cubic-bezier(.32,.72,0,1)}
.ofm_foldtoggle:hover svg{transform:translateY(1px)}
.ofm_foldtoggle:hover{color:var(--dsw-alias-label-primary)}
.ofm_foldtoggle svg{width:10px;height:10px;fill:currentColor;transition:transform .22s ease}
.ofm_foldtoggle[data-open="true"] svg{transform:rotate(90deg)}
/* ══ 骨架屏 ════════════════════════════════════════════════════════════ */
.ofm_skel{position:relative;overflow:hidden;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent);min-height:96px;}
.ofm_skel::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 30%,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent) 50%,transparent 70%);transform:translateX(-100%);}

.ofm_skel::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent,rgb(255 255 255 / 8%) 42%,transparent 74%);}

/* ══ 登录引导 ══════════════════════════════════════════════════════════ */
.ofm_loginbody{display:flex;flex-direction:column;gap:14px}
.ofm_loginstep{display:flex;gap:11px;align-items:flex-start;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.ofm_loginstep b{flex:none;width:21px;height:21px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:650;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent);color:var(--dsw-alias-state-business-primary)}
.ofm_scanline{}

/* ══ 数据看板 KPI ══════════════════════════════════════════════════════ */
.ofm_kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.ofm_kpi{display:flex;flex-direction:column;gap:6px;padding:15px 17px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 78%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 5%),0 1px 2px rgb(0 0 0 / 5%);transition:transform .22s cubic-bezier(.32,.72,0,1),box-shadow .24s ease,border-color .2s ease}
.ofm_kpi:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-border-l2));box-shadow:inset 0 1px 0 rgb(255 255 255 / 8%),0 16px 36px rgb(0 0 0 / 13%)}
.ofm_kpilabel{font-size:11px;font-weight:560;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.ofm_kpivalue{font-size:25px;font-weight:760;letter-spacing:-.7px;line-height:1.15;font-variant-numeric:tabular-nums;background:linear-gradient(120deg,var(--dsw-alias-label-primary),color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,var(--dsw-alias-label-primary)));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.ofm_kpi:hover .ofm_kpivalue{transform:translateY(-1px);transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
.ofm_kpivalue{transition:transform .3s cubic-bezier(.34,1.56,.64,1);display:inline-block}
.ofm_kpisub{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.ofm_kpi.warn .ofm_kpivalue{-webkit-text-fill-color:var(--dsw-alias-state-warning-primary,#f0a441);background:none}
.ofm_logfailed td{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 5%,transparent)}
/* ══ 真实图标与积分展示 ════════════════════════════════════════════════ */
.ofm_navmark img,.ofm_chanlogo img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}
.ofm_chanlogo{padding:0;overflow:hidden}
.ofm_credittotal b{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums}
.ofm_creditbadge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;padding:2px 9px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 50%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#f0a441) 9%,transparent);color:var(--dsw-alias-state-warning-primary,#f0a441);white-space:nowrap}
.ofm_creditbadge.strong{max-width:100%;white-space:normal;overflow-wrap:anywhere;color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 50%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
@media (max-width:760px){.ofm_tab{flex:1 1 auto;text-align:center}}
/* ══ 动效降级：用户系统开启"减少动态效果"时全部收敛 ═══════════════════ */
/* —— 交互锚点增强：激活态 / 状态色 / 加载态（additive，不改既有规则） —— */
/* tab：激活项在滑块底衬之上再补一道品牌下划线，选中更明确 */
.ofm_tab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.ofm_tab[aria-selected="true"]::after{content:"";position:absolute;left:12px;right:12px;bottom:3px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary);opacity:.85;transition:opacity .18s cubic-bezier(.32,.72,0,1)}
/* 渠道卡：随接入状态着色顶部 hairline 与外发光（已接入=品牌色、关闭=灰、待接入=琥珀弱化） */
.ofm_chan[data-state="on"]::before{background:linear-gradient(90deg,var(--chan-accent,var(--dsw-alias-state-business-primary)),color-mix(in srgb,var(--chan-accent,var(--dsw-alias-state-business-primary)) 30%,transparent));opacity:1}
.ofm_chan[data-state="on"]{border-color:color-mix(in srgb,var(--chan-accent,var(--dsw-alias-state-business-primary)) 34%,var(--dsw-alias-border-l2))}
.ofm_chan[data-state="idle"]::before{background:linear-gradient(90deg,var(--dsw-alias-state-warning-primary,#f0a441),transparent);opacity:.6}
.ofm_chan[data-state="off"]::before{background:linear-gradient(90deg,var(--dsw-alias-label-tertiary),transparent);opacity:.5}
/* 按钮：异步进行中显示内联 spinner（aria-busy 锚点，文字仍保留占位避免布局跳动） */
.ofm_btn[aria-busy="true"]{position:relative;color:transparent !important;pointer-events:none}
.ofm_btn[aria-busy="true"]::after{content:"";position:absolute;left:50%;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:2px solid color-mix(in srgb,currentColor 30%,var(--dsw-alias-label-secondary));border-top-color:var(--dsw-alias-label-primary);}

@media (prefers-reduced-motion:reduce){.ofm_root *,.ofm_root *::before,.ofm_root *::after{transition-duration:.01ms !important}}
/* ═══ 精密仪器精修层（世界观：原厂仪器手感）：颜色听宿主，质感在阻尼。曲线 --ease-instrument 冲得快落得稳，--ease-settle 极轻过冲。退场比进场快。 ═══ */
.ofm_glass{transition:border-color .22s var(--ease-instrument),box-shadow .26s var(--ease-instrument),transform .22s var(--ease-instrument),background .22s var(--ease-instrument)}
.ofm_glass:hover{border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 92%,var(--dsw-alias-state-business-primary));box-shadow:0 1px 2px rgb(0 0 0 / 5%),0 10px 28px -14px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.ofm_kpi{transition:border-color .22s var(--ease-instrument),transform .22s var(--ease-instrument),box-shadow .26s var(--ease-instrument)}
.ofm_kpi:hover{transform:translateY(-1px)}
.ofm_kpivalue{transition:transform .3s var(--ease-settle),color .2s var(--ease-instrument);display:inline-block}
.ofm_kpi:hover .ofm_kpivalue{transform:translateY(-1px) scale(1.015);color:var(--dsw-alias-label-primary)}
.ofm_table tbody tr{transition:background .14s var(--ease-instrument)}.ofm_seg button{transition:background .2s var(--ease-instrument),color .2s var(--ease-instrument),border-color .2s var(--ease-instrument),box-shadow .22s var(--ease-settle)}
.ofm_minibtn{transition:transform .14s var(--ease-instrument),border-color .18s var(--ease-instrument),color .18s var(--ease-instrument),background .18s var(--ease-instrument)}
.ofm_minibtn:active:not(:disabled){transform:scale(.98);transition-duration:.09s}
.ofm_root input,.ofm_root select,.ofm_root textarea{transition:border-color .18s var(--ease-instrument),box-shadow .2s var(--ease-instrument),background .18s var(--ease-instrument)}
@media (prefers-reduced-motion:reduce){.ofm_glass,.ofm_kpi,.ofm_kpivalue,.ofm_minibtn{transition:none!important}.ofm_kpi:hover,.ofm_kpi:hover .ofm_kpivalue{transform:none}}

/* ==== V5 INSTRUMENT START ==== */
/* 精密仪器·样板间覆盖层：1px细边+内高光，无外投影；颜色全部听宿主 var(--dsw-alias-*)。
   夜(暗)高光更刃、纹理更显；昼(亮)高光收敛、纹理近乎哑。reduced-motion 去位移留状态。 */

/* ── ① 面板卡片 .ofm_panel ─────────────────────────────────────── */
/* 双基底：拉丝细纹(repeating-linear-gradient)垫底，实体色覆盖在上，从边缘隐约透出拉丝感 */
.ofm_root .ofm_panel{
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
    color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, transparent) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%), inset 0 -14px 28px -18px rgb(0 0 0 / 16%) !important;
  transition: border-color .22s var(--ease-instrument), box-shadow .26s var(--ease-instrument), transform .22s var(--ease-instrument) !important;
}

/* ── ② 按钮 .ofm_btn ─────────────────────────── */
/* kinetic tension：外壳 active 陷落(scale .985)，内部 ::after 扫光条反向滑过形成"外陷内顶" */
.ofm_root .ofm_btn{
  position: relative !important;
  overflow: hidden !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%) !important;
  transition: transform .16s var(--ease-settle), border-color .2s var(--ease-instrument), background .2s var(--ease-instrument), box-shadow .2s var(--ease-instrument), opacity .16s var(--ease-instrument) !important;
}
.ofm_root .ofm_btn::after{
  content: "" !important;
  position: absolute !important;
  top: 0 !important; bottom: 0 !important;
  left: -60% !important; width: 42% !important;
  background: linear-gradient(100deg, transparent, rgb(255 255 255 / 14%), transparent) !important;
  transform: skewX(-18deg) !important;
  transition: left .5s var(--ease-instrument) !important;
  pointer-events: none !important;
}
/* hover：扫光滑过（exit slower than press）；去掉原外投影，仅留顶部高光 */
.ofm_root .ofm_btn:hover:not(:disabled){
  transform: translateY(-1px) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%) !important;
}
.ofm_root .ofm_btn:hover:not(:disabled)::after{
  left: 118% !important;
}
/* active：快速陷落(.09s) + 内阴影加深=物理按压；松开靠 --ease-settle 回弹 */
.ofm_root .ofm_btn:active:not(:disabled){
  transform: scale(.985) !important;
  transition-duration: .09s !important;
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 3%) !important;
}
/* primary 按钮保留主色渐变，仅把外投影换成更克制的内高光+轻凹槽 */
.ofm_root .ofm_btn.primary{
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%), inset 0 -10px 18px -12px rgb(0 0 0 / 24%) !important;
}
.ofm_root .ofm_btn.primary:hover:not(:disabled){
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 26%), inset 0 -10px 18px -12px rgb(0 0 0 / 18%) !important;
}

/* ── ③ 表格行 hover .ofm_table tbody tr ─────────────────────────── */
/* 行首 2px 主色竖条用 transform:scaleY 展开(不触发布局)；exit(.12s) 比 entrance(.16s) 快 */
.ofm_root .ofm_table tbody tr{
  transition: background .16s var(--ease-instrument) !important;
}
.ofm_root .ofm_table tbody tr td:first-child{
  position: relative !important;
}
.ofm_root .ofm_table tbody tr td:first-child::before{
  content: "" !important;
  position: absolute !important;
  left: 0 !important; top: 6px !important; bottom: 6px !important;
  width: 2px !important; border-radius: 2px !important;
  background: var(--dsw-alias-state-business-primary) !important;
  transform: scaleY(0) !important;
  transform-origin: center !important;
  opacity: 0 !important;
  transition: transform .16s var(--ease-instrument), opacity .12s var(--ease-instrument) !important;
  pointer-events: none !important;
}
.ofm_root .ofm_table tbody tr:hover td:first-child::before{
  transform: scaleY(1) !important;
  opacity: 1 !important;
}
/* 数字列表针走格感：tabular-nums + pl5-tick 机械顿挫(steps) */
.ofm_root .ofm_table td{
  font-variant-numeric: tabular-nums !important;
}
/* ── 昼(not-dark)收敛：高光更哑、拉丝更隐、回弹更小 ─────────────── */
@media not (prefers-color-scheme: dark){.ofm_root .ofm_panel{
    background:
      repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
      color-mix(in srgb, var(--dsw-alias-bg-layer-2) 90%, transparent) !important;
  }
  .ofm_root .ofm_panel{
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 45%), inset 0 -14px 28px -18px rgb(0 0 0 / 7%) !important;
  }
  .ofm_root .ofm_btn{
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 50%) !important;
  }
  .ofm_root .ofm_btn:hover:not(:disabled){
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 62%) !important;
  }
}

/* ── reduced-motion 降级：去位移/回弹/扫光/顿挫，保留颜色与不透明度反馈 ── */
@media (prefers-reduced-motion: reduce){.ofm_root .ofm_panel,.ofm_root .ofm_btn,.ofm_root .ofm_table tbody tr,.ofm_root .ofm_table tbody tr td:first-child::before,.ofm_root .ofm_switch i,.ofm_root .ofm_switch i::after,.ofm_root .ofm_seg button,.ofm_root .ofm_input,.ofm_root .ofm_chanlogo{
    transition: border-color .12s ease, background .12s ease, box-shadow .12s ease, opacity .12s ease, color .12s ease !important;
  }.ofm_root .ofm_btn:hover:not(:disabled),.ofm_root .ofm_btn:active:not(:disabled),.ofm_root .ofm_seg button:active:not([aria-pressed="true"]),.ofm_root .ofm_chan:hover .ofm_chanlogo{
    transform: none !important;
  }
  /* 开关捏扁还原 */
  .ofm_root .ofm_switch:active i::after{
    width: 14px !important;
  }.ofm_root .ofm_btn::after{
    content: none !important;
  }
  /* 呼吸灯停跳，但保留颜色状态 */
  .ofm_root .ofm_dot.ok{
    
    opacity: 1 !important;
  }.ofm_root .ofm_kpi:hover .ofm_kpivalue{
    
  }
}

/* ── ④ 输入框 .ofm_input：仪器凹槽手感 ─────────────────────────── */
/* 常态凹槽(inset 顶高光+底内阴影)；focus 时凹槽不动，只换边色+外发光，像仪器被点亮 */
.ofm_root .ofm_input{
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 10%) !important;
  transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument), background .18s var(--ease-instrument) !important;
}
.ofm_root .ofm_input:hover{
  border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 55%, var(--dsw-alias-state-business-primary)) !important;
}
.ofm_root .ofm_input:focus{
  border-color: var(--dsw-alias-state-business-primary) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 8%), 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent) !important;
}

/* ── ⑤ 开关 .ofm_switch：spring 滑块阻尼 ─────────────────────────── */
/* 滑块用 --ease-settle 带回弹；按下时滑块变宽=被"捏扁"，松开回弹归位 */
.ofm_root .ofm_switch i{
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 10%), inset 0 -1px 0 rgb(255 255 255 / 4%) !important;
  transition: background .22s var(--ease-instrument), border-color .22s var(--ease-instrument), box-shadow .22s var(--ease-instrument) !important;
}
.ofm_root .ofm_switch i::after{
  background: var(--dsw-alias-label-primary) !important;
  box-shadow: 0 1px 3px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 20%) !important;
  transition: transform .28s var(--ease-settle), background .2s var(--ease-instrument), width .14s var(--ease-instrument) !important;
}
.ofm_root .ofm_switch[aria-checked="true"] i{
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 14%), inset 0 -1px 0 rgb(255 255 255 / 8%) !important;
}
.ofm_root .ofm_switch[aria-checked="true"] i::after{
  background: var(--dsw-alias-label-on-accent, #fff) !important;
}
.ofm_root .ofm_switch:active i::after{
  width: 17px !important;
}.ofm_root .ofm_pill{
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%) !important;
  transition: border-color .2s var(--ease-instrument), color .2s var(--ease-instrument), background .2s var(--ease-instrument), transform .18s var(--ease-settle) !important;
}
.ofm_root .ofm_badge{
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%) !important;
  transition: border-color .2s var(--ease-instrument), color .2s var(--ease-instrument), background .2s var(--ease-instrument) !important;
}
/* 状态点呼吸灯保留，但改成 pl5- 前缀、机械顿挫更明显的两拍节奏 */

.ofm_root .ofm_dot.ok{

}
/* 分段控件选中块：加顶部高光，按下时微微陷落 */
.ofm_root .ofm_seg button[aria-pressed="true"]{
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%), inset 0 1px 0 rgb(255 255 255 / 8%) !important;
  transition: color .18s var(--ease-instrument), background .18s var(--ease-instrument), box-shadow .2s var(--ease-settle) !important;
}
.ofm_root .ofm_seg button:active:not([aria-pressed="true"]){
  transform: scale(.97) !important;
}

/* ── ⑦ 原生件接管：滚动条 / selection / caret / 聚焦环 ─────────────── */
/* 滚动条：仪器滑轨——thumb 加顶部高光与底部凹槽，hover 时轻微增亮 */
.ofm_root ::-webkit-scrollbar-thumb{
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), inset 0 -1px 0 rgb(0 0 0 / 10%) !important;
  transition: background .2s var(--ease-instrument) !important;
}
.ofm_root ::-webkit-scrollbar-thumb:hover{
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 48%, transparent) !important;
}
/* 文本选择：主色薄涂，昼模式再淡一点避免刺眼 */
.ofm_root ::selection{
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent) !important;
}
/* 光标：跟随主色 */
.ofm_root input, .ofm_root textarea{
  caret-color: var(--dsw-alias-state-business-primary) !important;
}
/* 聚焦环：仪器刻度环——细环+外晕，用 --ease-instrument 淡入 */
.ofm_root :focus-visible{
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 72%, transparent) !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent) !important;
  transition: box-shadow .18s var(--ease-instrument), outline-color .18s var(--ease-instrument) !important;
}

/* ── ⑧【师傅批改①】拉丝纹理增强：金属感要真的能摸到 ─────────────── */
/* 夜模式 3% → 4.5%，昼模式 1.5% → 2.8%，纹理间隔收紧让拉丝更密 */
.ofm_root .ofm_panel{
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
    color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, transparent) !important;
}
@media not (prefers-color-scheme: dark){.ofm_root .ofm_panel{
    background:
      repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
      color-mix(in srgb, var(--dsw-alias-bg-layer-2) 90%, transparent) !important;
  }
}

/* ── ⑧【师傅批改②】昼模式高光压暗：45-62% → 30-38%，更克制 ─────────── */
@media not (prefers-color-scheme: dark){
  .ofm_root .ofm_panel{
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 34%), inset 0 -14px 28px -18px rgb(0 0 0 / 6%) !important;
  }
  .ofm_root .ofm_btn{
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 36%) !important;
  }
  .ofm_root .ofm_btn:hover:not(:disabled){
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 44%) !important;
  }.ofm_root .ofm_pill,.ofm_root .ofm_badge{
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 30%) !important;
  }
  .ofm_root .ofm_input{
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 34%), inset 0 2px 6px -2px rgb(0 0 0 / 6%) !important;
  }
}
/* 导航标：去掉 #3ECFA0 混色，改混 label-primary；外投影换成内高光+轻凹槽 */
.ofm_root .ofm_navmark{
  background: linear-gradient(145deg, var(--dsw-alias-state-business-primary), color-mix(in srgb, var(--dsw-alias-state-business-primary) 58%, var(--dsw-alias-label-primary))) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 26%), inset 0 -6px 12px -8px rgb(0 0 0 / 20%) !important;
}
.ofm_root .ofm_navmark svg{
  fill: var(--dsw-alias-label-on-accent, #fff) !important;
}
/* 渠道标：--chan-accent 兜底本来就是宿主变量，收编写死的 #fff / #101828，外投影换内高光 */
.ofm_root .ofm_chanlogo{
  color: var(--dsw-alias-label-on-accent, #fff) !important;
  background: linear-gradient(150deg, var(--chan-accent, var(--dsw-alias-state-business-primary)), color-mix(in srgb, var(--chan-accent, var(--dsw-alias-state-business-primary)) 52%, var(--dsw-alias-bg-layer-3))) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 24%), inset 0 -8px 14px -10px rgb(0 0 0 / 22%) !important;
  transition: transform .3s var(--ease-settle) !important;
}
.ofm_root .ofm_chan:hover .ofm_chanlogo{
  transform: scale(1.05) rotate(-2deg) !important;
}
/* 渠道卡顶条(::before 用 --chan-accent)：收敛高度与发光，听宿主凹槽语言 */
.ofm_root .ofm_chan::before{
  height: 2px !important;
  box-shadow: 0 1px 0 rgb(255 255 255 / 6%) !important;
}
.ofm_root .ofm_chan[data-state="on"]{
  border-color: color-mix(in srgb, var(--chan-accent, var(--dsw-alias-state-business-primary)) 30%, var(--dsw-alias-border-l2)) !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%) !important;
}.ofm_root .ofm_kpivalue{
  display: inline-block !important;
}.ofm_root .ofm_kpi:hover .ofm_kpivalue{
  
}

@media (prefers-reduced-motion:reduce){.ofm_kpi,.ofm_chan{transition:none}}
`

    // ── helpers ───────────────────────────────────────────────────────────────
    // 用页面 base 解析，而不是 origin-absolute 的「/api/...」：DSH 挂在反向代理
    // 子路径下（https://<host>/<prefix>/）时，前导斜杠会把 <prefix> 丢掉，请求
    // 直接打到站点根被前置网关 404，设置面板报「无法连接插件后端」（#54）。
    // 相对路径随页面 base 走，根路径部署下与原值完全一致。解析不了（无 document
    // 的宿主、非常规 base）就退回根路径原值——行为不比修复前差。
    const API = (() => {
      try { return new URL('api/our-free-model', document.baseURI).pathname } catch { return '/api/our-free-model' }
    })()

    async function api(path, options) {
      // 8 秒超时兜底：后端路由未注册/挂起时 fetch 不再永久挂起——一个不响应的
      // 端点否则会长期占用同源连接池。超时按 AbortError 抛给调用方，走各自
      // .catch 降级路径；确实要等宿主跑完的慢路由可传 options.timeout 放宽。
      const { timeout = 8000, ...fetchOptions } = options ?? {}
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const response = await fetch(`${API}${path}`, { ...fetchOptions, redirect: 'error', signal: ctrl.signal })
        const text = await response.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 200) } }
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        return payload
      } finally {
        clearTimeout(timer)
      }
    }

    const post = (path, body, timeout) => api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      ...timeout === undefined ? {} : { timeout },
    })

    function useAsync(loader, deps) {
      const [state, setState] = useState({ status: 'loading', data: undefined, error: '' })
      const run = useCallback(() => {
        let alive = true
        setState(current => ({ ...current, status: 'loading' }))
        loader().then(data => { if (alive) setState({ status: 'ready', data, error: '' }) })
          .catch(error => { if (alive) setState({ status: 'error', data: undefined, error: String(error?.message ?? error) }) })
        return () => { alive = false }
      }, deps)
      useEffect(() => run(), [run])
      return { ...state, reload: run }
    }

    function kilo(value) {
      const n = Math.round(Number(value) || 0)
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
      if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`
      return String(n)
    }

    function ago(ts, locale) {
      if (!ts) return '—'
      const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000))
      const zh = String(locale ?? '').toLowerCase().startsWith('zh')
      if (seconds < 60) return zh ? `${seconds} 秒前` : `${seconds}s ago`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`
      const hours = Math.round(minutes / 60)
      if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`
      return zh ? `${Math.round(hours / 24)} 天前` : `${Math.round(hours / 24)}d ago`
    }

    function copy(text, done) {
      const finish = ok => done(ok)
      if (navigator?.clipboard?.writeText !== undefined) {
        navigator.clipboard.writeText(text).then(() => finish(true), () => finish(legacy(text)))
        return
      }
      finish(legacy(text))
    }
    function legacy(text) {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
      } catch { return false }
    }

    // ── announcement HTML: strict allowlist, no innerHTML sink ───────────────
    // The feed is authored by the repository owner, but rendering is a trust
    // boundary of its own: the feed URL can be pointed anywhere, and a
    // compromised repository must never become script execution. Nothing here
    // hands a string to the HTML engine — the tokenizer walks the text, drops
    // everything off the allowlist, and builds a virtual tree that both React
    // and plain DOM can materialize. The same parser is exercised headlessly
    // by scripts/sanitize-test.mjs.
    const ALLOWED_TAGS = new Set(['a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'])
    /** Everything these elements contain is dropped, closing tag included. */
    const DROP_CONTENT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title', 'svg', 'math', 'form', 'input', 'button', 'select', 'option', 'video', 'audio', 'canvas', 'link', 'meta', 'base'])
    const VOID_TAGS = new Set(['br', 'hr', 'img'])
    const MAX_HTML_NODES = 4000
    const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration'])
    const STYLE_CAMEL = { 'background-color': 'backgroundColor', 'text-align': 'textAlign', 'font-weight': 'fontWeight', 'font-style': 'fontStyle', 'text-decoration': 'textDecoration', color: 'color' }

    /** http(s), mailto and in-page fragments only; images additionally accept inline PNG/JPEG/GIF/WebP. */
    function safeUrl(raw, isImage) {
      const value = String(raw ?? '').trim()
      if (value === '' || value.length > 2000) return undefined
      const lower = value.toLowerCase()
      if (/^https?:\/\//.test(lower)) return value
      if (lower.startsWith('mailto:') && /^[^@\s]+@[^@\s]+$/.test(value.slice(7))) return value
      if (lower.startsWith('#')) return value
      if (isImage && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value
      return undefined
    }

    function sanitizeStyle(raw) {
      const out = {}
      for (const decl of String(raw ?? '').split(';')) {
        const idx = decl.indexOf(':')
        if (idx === -1) continue
        const prop = decl.slice(0, idx).trim().toLowerCase()
        const value = decl.slice(idx + 1).trim()
        if (!ALLOWED_STYLE_PROPS.has(prop) || value === '' || value.length > 120) continue
        if (/url\(|expression|javascript:|@|<|>/.test(value.toLowerCase())) continue
        out[STYLE_CAMEL[prop]] = value
      }
      return out
    }

    function sanitizeAttrs(tag, attrText) {
      const props = {}
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
      let match
      while ((match = attrRe.exec(attrText ?? '')) !== null) {
        const key = match[1].toLowerCase()
        const value = match[3] ?? match[4] ?? match[5] ?? ''
        if (key === 'style') {
          const style = sanitizeStyle(value)
          if (Object.keys(style).length > 0) props.style = style
          continue
        }
        if (tag === 'a' && key === 'href') {
          const url = safeUrl(value)
          if (url !== undefined) {
            props.href = url
            props.target = '_blank'
            props.rel = 'noopener noreferrer'
          }
          continue
        }
        if (tag === 'img' && key === 'src') {
          const url = safeUrl(value, true)
          if (url !== undefined) props.src = url
          continue
        }
        if ((tag === 'img' || tag === 'a') && key === 'title') { props.title = value.slice(0, 300); continue }
        if (tag === 'img' && key === 'alt') { props.alt = value.slice(0, 300); continue }
        if ((key === 'width' || key === 'height') && /^\d{1,4}$/.test(value)) { props[key] = Number(value); continue }
      }
      return props
    }

    /**
     * Tokenize announcement HTML into a virtual tree of
     * `{type:'el', tag, props, children}` and `{type:'text', text}` nodes.
     * Disallowed elements are unwrapped (their children survive); the content
     * of raw-text elements such as `<script>` is dropped entirely.
     */
    function parseSafeHtml(html) {
      if (typeof html !== 'string' || html.trim() === '') return []
      const root = { type: 'root', children: [] }
      const stack = [root]
      const top = () => stack[stack.length - 1]
      let nodes = 0
      let skipUntil = null
      const tokenRe = /<!--[\s\S]*?-->|<\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>|<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g
      let match
      while ((match = tokenRe.exec(html)) !== null) {
        if (nodes >= MAX_HTML_NODES) break
        if (match[0].startsWith('<!--')) continue
        if (match[4] !== undefined) {
          if (skipUntil === null) {
            const text = match[4]
            if (text.trim() !== '' || (top().children.length > 0 && typeof top().children[top().children.length - 1] !== 'string')) {
              top().children.push(text)
            }
          }
          continue
        }
        const name = (match[1] ?? match[2] ?? '').toLowerCase()
        if (name === '') continue
        if (match[1] !== undefined) {
          // closing tag
          if (skipUntil !== null) {
            if (name === skipUntil) skipUntil = null
            continue
          }
          if (!ALLOWED_TAGS.has(name)) continue
          let depth = stack.length - 1
          while (depth > 0 && stack[depth].tag !== name) depth -= 1
          if (depth === 0) continue
          while (stack.length - 1 > depth) {
            const dropped = stack.pop()
            top().children.push(...dropped.children)
          }
          const frame = stack.pop()
          top().children.push({ type: 'el', tag: frame.tag, props: frame.props, children: frame.children })
          nodes += 1
          continue
        }
        // opening tag
        if (skipUntil !== null) continue
        if (DROP_CONTENT_TAGS.has(name)) { skipUntil = name; continue }
        if (!ALLOWED_TAGS.has(name)) continue
        const props = sanitizeAttrs(name, match[3])
        if (name === 'img' && props.src === undefined) continue
        if (VOID_TAGS.has(name)) {
          top().children.push({ type: 'el', tag: name, props, children: [] })
          nodes += 1
          continue
        }
        stack.push({ tag: name, props, children: [] })
      }
      while (stack.length > 1) {
        const frame = stack.pop()
        top().children.push(...frame.children)
      }
      return root.children
    }

    /** Materialize the virtual tree as DOM nodes (for toasts and modals). */
    function htmlToDom(nodes) {
      return nodes.map(node => {
        if (typeof node === 'string') return document.createTextNode(node)
        const el = document.createElement(node.tag)
        for (const [key, value] of Object.entries(node.props ?? {})) {
          if (key === 'style') { Object.assign(el.style, value); continue }
          el.setAttribute(key, String(value))
        }
        for (const child of htmlToDom(node.children ?? [])) el.appendChild(child)
        return el
      })
    }

    // ── toasts: a vanilla-DOM host so pushes surface on every page ───────────
    // Slot content only exists where the shell mounts it; a toast that lived
    // inside the settings section would be invisible everywhere else. This
    // host attaches to document.body, outside the app root, and needs no
    // react-dom — the body renders through the same allowlist parser.
    function toastHost() {
      let host = document.querySelector('.ofm_toasts')
      if (host === null) {
        host = document.createElement('div')
        host.className = 'ofm_toasts'
        document.body.appendChild(host)
      }
      return host
    }

    function showToast({ title, body, html, tone, actions = [], holdMs = 10000 }) {
      try {
        const host = toastHost()
        const card = document.createElement('div')
        card.className = 'ofm_toast' + (tone === undefined ? '' : ` ${tone}`)
        const head = document.createElement('div')
        head.className = 'ofm_toasttitle'
        head.appendChild(document.createTextNode(title ?? ''))
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'ofm_toastclose'
        // No locale lookup in here on purpose: showToast also runs from the
        // push subscription before any `t` binding is in scope, and a throw
        // inside this try/catch would silently swallow the whole toast.
        close.setAttribute('aria-label', 'close')
        close.title = '✕'
        close.textContent = '✕'
        close.addEventListener('click', () => card.remove())
        head.appendChild(close)
        card.appendChild(head)
        if (body !== undefined && body !== '') {
          const area = document.createElement('div')
          area.className = 'ofm_toastbody'
          area.textContent = String(body)
          card.appendChild(area)
        } else if (html !== undefined) {
          const area = document.createElement('div')
          area.className = 'ofm_toastbody'
          for (const node of htmlToDom(parseSafeHtml(html))) area.appendChild(node)
          card.appendChild(area)
        }
        if (actions.length > 0) {
          const row = document.createElement('div')
          row.className = 'ofm_toastactions'
          for (const action of actions) {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'ofm_btn'
            btn.textContent = action.label
            btn.addEventListener('click', () => { card.remove(); action.onClick?.() })
            row.appendChild(btn)
          }
          card.appendChild(row)
        }
        host.appendChild(card)
        while (host.children.length > 4) host.firstElementChild?.remove()
        if (holdMs > 0) {
          const timer = setTimeout(() => card.remove(), holdMs)
          timer.unref?.()
        }
        return card
      } catch { /* a toast must never break its caller */ }
      return undefined
    }

    const Switch = (props) => h('button', {
      type: 'button',
      className: 'ofm_switch',
      role: 'switch',
      'aria-checked': props.checked ? 'true' : 'false',
      // Several call sites already pass `disabled` (the gateway switch does, while
      // its RPC is in flight) and it was silently dropped, so a switch stayed
      // clickable through a write it could not survive. Passing it through is what
      // those call sites meant.
      disabled: props.disabled === true,
      onClick: props.onChange,
    }, h('i'), props.label === undefined ? null : h('span', null, props.label))

    const Pill = (props) => h('span', { className: `ofm_pill${props.strong ? ' strong' : ''}` },
      props.tone === undefined ? null : h('span', { className: `ofm_dot ${props.tone}` }),
      props.children)

    const Button = props => h('button', {
      type: 'button',
      className: 'ofm_btn' + (props.kind === undefined ? '' : ' ' + props.kind),
      disabled: props.disabled,
      onClick: props.onClick,
      title: props.title,
    }, props.children)

    function Section(props) {
      return h('section', { className: 'ofm_sec' },
        h('div', { className: 'ofm_sechead' },
          h('span', { className: 'ofm_sec_title' }, props.title),
          props.hint === undefined ? null : h('span', { className: 'ofm_sec_hint' }, props.hint)),
        props.children)
    }

    function Panel(props) {
      return h('div', { className: 'ofm_panel' },
        props.title === undefined ? null : h('div', { className: 'ofm_paneltitle' }, props.title, props.hint === undefined ? null : h('span', { className: 'ofm_sec_hint' }, props.hint)),
        props.children)
    }

    // ── egress outlet ─────────────────────────────────────────────────────────
    // Two ways out: a Clash subscription load-balanced by a spawned mihomo, or
    // one hand-written http/https/socks5 URL. Until this is on AND started,
    // egressFetch sends every request direct — nothing here is load-bearing for
    // plain use. The address is a credential, so it never rides along in the
    // settings payload: this panel shows the masked host and pulls the value
    // itself (`/egress/url`) only when the owner asks to see or copy it.
    function Egress(props) {
      const { settings, t, onApply, busy } = props
      const [draft, setDraft] = useState(settings.egress ?? {})
      useEffect(() => setDraft(settings.egress ?? {}), [settings.egress?.enabled, settings.egress?.mode, settings.egress?.urlLabel, settings.egress?.hasUrl, settings.egress?.active, settings.egress?.error])
      const [urlShown, setUrlShown] = useState(false)
      const [urlValue, setUrlValue] = useState('')
      const [copied, setCopied] = useState('')
      const readUrl = () => api('/egress/url').then(payload => String(payload?.url ?? '')).catch(() => '')
      // Which node url-test is carrying traffic on, and what the last gateway
      // round trip cost. mihomo re-ranks on its own schedule, so while the outlet
      // is on this polls instead of trusting the snapshot that shipped with the
      // settings. `/outlet` reads the controller, so it is only worth calling
      // when an outlet is actually running.
      const live = useAsync(() => api('/outlet'), [settings.egress?.enabled, settings.egress?.active])
      const reloadOutlet = live.reload
      const running = settings.egress?.active === true
      useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(() => reloadOutlet(), 15_000)
        return () => clearInterval(timer)
      }, [running, reloadOutlet])
      const status = running && live.data ? live.data : draft
      const node = typeof status?.node === 'string' ? status.node : ''
      const nodeDelayMs = Number(status?.nodeDelayMs ?? 0)
      const subscription = draft?.mode !== 'client'
      const statusLine = text => h('code', { className: 'ofm_mono', style: { padding: '4px 8px', flex: 1, minWidth: 200 } }, text)
      // The stored address is never in the payload this panel was rendered
      // from, so "see it" and "copy it" both cost one on-demand fetch, and the
      // masked form is all this page holds the rest of the time.
      const revealUrl = async () => {
        if (urlShown) { setUrlShown(false); return }
        setUrlValue(await readUrl())
        setUrlShown(true)
      }
      const copyUrl = async () => {
        const value = await readUrl()
        if (value === '') return
        copy(value, ok => {
          if (!ok) return
          setCopied('egressUrl')
          setTimeout(() => setCopied(''), 1600)
        })
      }
      const urlMask = draft?.hasUrl === true ? `${draft?.urlLabel ?? ''}/…` : t('egress.urlNone')
      const apply = () => {
        const patch = { enabled: draft?.enabled === true, mode: subscription ? 'subscription' : 'client', mihomoPath: String(draft?.mihomoPath ?? '') }
        // Empty means "keep the stored address": this panel never received it,
        // so it has nothing to send back, and an empty string would read as
        // "clear it" on the receiving end.
        if (String(draft?.url ?? '') !== '') patch.url = String(draft.url)
        onApply({ egress: patch })
      }
      return h(Panel, null,
        h('div', { className: 'ofm_row' },
          h(Switch, { checked: draft?.enabled === true, label: t('egress.enabled'), onChange: () => setDraft(c => ({ ...c, enabled: !(c?.enabled === true) })) }),
          h('span', { className: 'ofm_pill' }, h('span', { className: `ofm_dot ${draft?.active === true ? 'ok' : draft?.error ? 'err' : ''}` }), draft?.active === true ? t('egress.active') : t('egress.inactive'))),
        h('div', { className: 'ofm_row' },
          h(Switch, { checked: subscription, label: t('egress.modeSubscription'), onChange: () => setDraft(c => ({ ...c, mode: subscription ? 'client' : 'subscription' })) })),
        h('div', { className: 'ofm_row' },
          h('span', { className: 'ofm_note' }, t('egress.url')),
          h('code', { className: 'ofm_mono', style: { padding: '4px 8px', flex: 1, minWidth: 200, letterSpacing: urlShown ? 0 : 1 } },
            urlShown ? (urlValue === '' ? t('egress.urlNone') : urlValue) : urlMask),
          h(Button, { kind: 'ghost', onClick: revealUrl }, urlShown ? t('forward.hide') : t('forward.show')),
          h(Button, { kind: 'ghost', onClick: copyUrl }, copied === 'egressUrl' ? t('forward.copied') : t('forward.copy')),
          // Deleting the address is still a thing the owner may want, and the
          // panel cannot express it by sending back a field it never held — so
          // it says so outright, and the outlet goes down with the credential.
          h(Button, { kind: 'ghost', title: t('egress.urlClearWarn'), disabled: draft?.hasUrl !== true || busy, onClick: () => {
            setUrlShown(false)
            setUrlValue('')
            onApply({ egress: { enabled: false, mode: subscription ? 'subscription' : 'client', mihomoPath: String(draft?.mihomoPath ?? ''), url: '' } })
          } }, t('egress.urlClear'))),
        h('div', { className: 'ofm_row' },
          field(t('egress.urlNew'), h('input', { className: 'ofm_input', style: { flex: 1, minWidth: 260 }, value: draft?.url ?? '', placeholder: t('egress.urlPlaceholder'), onChange: e => setDraft(c => ({ ...c, url: e.target.value })) })),
          h(Button, { kind: 'primary', disabled: busy, onClick: apply }, t('egress.apply'))),
        subscription ? h('div', { className: 'ofm_row' },
          field(t('egress.mihomoPath'), h('input', { className: 'ofm_input', style: { flex: 1, minWidth: 260 }, value: draft?.mihomoPath ?? '', placeholder: 'auto', onChange: e => setDraft(c => ({ ...c, mihomoPath: e.target.value })) })),
          h('span', { className: 'ofm_note' }, t('egress.mihomoHint'))) : null,
        draft?.error ? h('div', { className: 'ofm_callout ofm_error' }, t('egress.error').replace('{message}', draft.error)) : null,
        h('div', { className: 'ofm_note' }, t('egress.direct')),
        running ? h('div', { className: 'ofm_row' },
          h('span', { className: 'ofm_note' }, t('egress.outlet')),
          statusLine(`${draft.outlet ?? ''} · ${draft.mode ?? ''}`)) : null,
        running ? h('div', { className: 'ofm_row' },
          h('span', { className: 'ofm_note' }, t('egress.node')),
          statusLine(node === '' ? t('egress.measuring') : nodeDelayMs > 0 ? `${node} · ${nodeDelayMs}ms` : node)) : null)
    }

    const field = (label, control) => h('label', { className: 'ofm_field' }, h('span', null, label), control)

    // ── 白嫖模型接入页 ────────────────────────────────────────────────────────
    // Real channel logos carried over from the upstream Channel Pack client (see
    // vendor/channel-pack/NOTICE.md) — the same artwork users know from those
    // products, embedded so no network fetch is involved. Channels without an
    // entry fall back to their two-letter tile.
    const CHANNEL_ICONS = {
      'codearts': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAcgUlEQVR4nNV7eZBd1Znf7/vOufe+93pvtYQkJNQWYEALAjeYzSCBM7IAY1xOmj8ydpzMTHDFSVUmU5VKKjU1rU5VJqmKKy6XZ6rG2PGEOJmZSBlj4w0DtiQb8ILbIEDLaBegBbT09vot995zvtR37nutRkIbeKYmR7r93r33vHPPt6+XcHmDBKAxwJQAOgHwYLi87F2mDl7w/NCyi8955/nZ94pxZZTJPuzDgp4F/sDYkB8GPIVt/oaHAKQIwP8HQyCXvE++tAVBWwEjgMHf87EFYh8bGrOXigS6FOApfMye847u7l5K0y7nbVkkivR6DiGLuDWvExE6RdAl+l2SRIAEQNxaJUYad7bOW0esn52znym6Wt+Le86XmITJkpVc8rBvISsSUWbYN5MZmbk53jdJOx9J23sdwQiPYtRfCD57MeDHijlZ+9rLuOKqpNG4GbCr4OkqsO8WEBkxJCTCYXq4kgPkvYjAidfbgIcgAtiARJmP4NkD5CCeC/7yBmACGweICBmCd8zMiDzrol5IJwQEcM5iJsTJ2/VIDoy5JS+D8GqbXIuHNpqRMeBCSLCXQPlsBODhyvwFLnWDhOzDAhkSYBVIlgCuGzAMEp3vFXRVQgJRCDwoLKXgeRDrn7CyXi5wwK2jzYzt+wpg+LGeM8ARg7hQcMreBBZxID8BmLeF+MC0XbDsiVXHFzRq3XsW7i8fu3eMAuFUHM6nGO35gEdBj1y/PdyxcB43848TsF7gV5NgHghdQj5Ruoetk05XPFgQjH4LwBgmCHPYghKOyMCTgSGC120F2EyYEwirnwq4XiOGsHJMBEtRgaiW3Aq4oA5JWcADGcfLalIaylx5nYvx9J7l9b/CAbyu87euhZFt4t4NCfZCSkER8caVS0pTEzPXgXi9BR6swFRUyPQQOO8gTgJrF2u3Mae0DhYp0PzMff2rd/S8uKpX2p/hNwDcnLvF/fAYUXEp9uZJUahPsQxUEqFKUjL9/Q3nBsVnjBLv/i9DMrl8Oap4exYi5Rw5rxUQ5dWCDjrJbV22LJkYH7/W5rgLIjdWwBWdlyoDqzYUYpXSwKRnYPMqvMXTSG2y7lqvzTlwgYM8RA94mT1ERUvOHCweBiliTqVCNSljWmLMKKqtRcPytdMx3VuXfGjHYXSs24ZA/U3DCu87rYN9FwngFunk16dOddk0usmD7iTwwhwIFM/1A15/a0xgTDYGqq7a/xgGJnwW/GAK5UcRhCJ4sq3P4ry4HgOUFAcnED1MqThY3S61IoX4eGV/sUjFoC7WNyVydbZ5Ks7W2dBURL1TxENVkjfyDLsJNKWAPXuggO28CNgI0PAcrujITJfzWA1ShYfuoNZJt5CThze6HZV1/YFV8W3JPc/5Vyg4lec2IhQAC4GdRUSBABs+w8FxgYCApAIp4RwxHCJkiJFLhAYIVfJcJ6DJhBkjdso4mjDcUSW6qsm8FBHKbXjG66ARbKTROWbd4gIjE1cyBgsA7lcb3IQIiyOm3Fj2lAMuA03n4qchvk7iPMMRIWdCLnpAUiFvJTCe2ga1isGhdtAVRC2sJEHiz+wrg0gOsD7RQbhJnssMWPGI0KASTUtHPE2lrirb7owpqjMwZUDjxsu0tdQg6fBBUSvrnX/YszhAdsy9GaeeHGcecKRSqMxDEiy+Maot0CDm/Vb8Sz6XPc75yUBzJxHDOyHvYBRPxqtg65oOXNg/VRPUbFlJpb4BpLVXl+siYO/FW6emyDiKYkOJAwxNU9T5elwZnPDmQznhRlgbVUl4ir1UmSg1QF6oKTU0Z5TeSmB050ZRz+CSOCBnyi3cDMNXhaXPBgToPwpOWKy+i3VIyU/EOf2kfNrsmgZzjnpXDut60ZGfKiPvoC4/jZMEzIef9RYV0EPoxQRwehATy64uAp6JQ4Be6wW6VWLSEg7EYo+Y+aV7va1d9epL9T++5ZZrXuu0n7JCKGcqkvA1JppRviP1qch5kSkQpjyfceIuygE6dmLOSCmFpdMgnLJWBgyhpKpd7RExucSglDCuyUlOcyV9Zt6p+vQAnxb5EGYwVmj1RVNzKHDesQ04/Pg7L03O+U6EZf/El/7p49TQ04/2SATrb6ow39Bocokz5E2CcUadCGU21AA+wuKOghB+o+PAgXP3wmdfmN/SksEZiuOqh3kFTLs5YtdTIlMpgUyCnGKSKCaTROiJLN3EBhtOryrdefAqlGgMGSm3q6U8c9A7D3mX48x19eNHRoRH1opVZj78ODXWrt1iN2yQqylxHyPCLWLQ37CwVYak5J1q5MiwEdHn+53C8mptHDNt07d8+TstwDkcoKYvOOwANg+Dl2+emubOhc910slFFOEjlQjdQiSZ6gSiWP3bGSINc/qF5B+lTVexFFWBbHtYcC0I6yAYDTuQS4vDZq8LNm6kFRvByiA6Gr23LyHKP8uePsU5FmaKYl3YwrDnvP1zT/40IvkFxTO/6pvXUx1eDt68GW7z5kBXuaAIcAsB4wfAt6g6rr51Yu/85GXifEfG6DOGumKFmcBZMTfvYMQl0NIp5+9nw2+/vSzio43+PbTtrRndfPHUkcBtG8Ohiujdx0ZsJIxsxM5R0GYitxNIh4clnkhwJfLsIZ/TpyyZlQHQps/Vh2bWYKTwF3OvCgTb89i/+vT3escDHZSL2kg9a9izL7SMET02duZKT7lxsEn26SZR2TFuLxmUcoF3Hk4Roaivk6hXtMQb/xlnMdDPU/8DoF+2nslYOxpIuzF4ZaPnQwANDwu9DdAC9do2BzHCyXn4ADXy3wbzQ2TMtcGXDN4xCLlG4jCqm3KPKfZ43pP8IKbo8FmQneMGX9AK9IXIruXae0ycMLStTlIxkPkidH0EGFWvOiETOEfIVClWCIM1wQORTSeOrEyiim3soO2YaLOxDo0u1eS+QywKTwFK9faltZ+VkhtsLveT2QMs/EnjzGpFiWv6TJ1Niov9qTFSE52lOGaAHxGb54YOYGp6rdht2+DWrYPfNuf5F80IESCaW9PvY0MgehP1+ch2mYh+yIStmeBw3UM0uLOsFiGEvZFCkxJgDZbaCJ+Obf6vcjb37B9Czyyca2E3rgiIP6MERGjtVhg92ogIm1tUW2nr9Htk6HeQmOskLlwFsWIkErXD6hzCqd0XTDH57R54YekEDo7upPS664pnjI6eK/sX5QBquSpDnYFKRIfRkBuz3eMpnmp4E2toHDEtS4oMiJJTMlEzjKzMKFcslk442cBM9V4TJ8dvobF6R/MobTtjljYNw+xYMSKjRH6bht6tcesfT84rG1rh0/hj3MBDZO016lF7n2scZsgq6sEhr6LuRAMnGXiBSZ7OCfsfC3kAoUWL2hx2/iQpn+9GGwnYFuSwyEu8ghlK8Jyz+Csy2CaQ464dB2jMW+Q7Ir1W90Bi0GsZD5L3ny8Z90hvM1oxS3SA7qoPJRgcjLFp02yuce0XZCCO+KPe8O+jZD+Dkh0MsqK0tGIRkaeYQzihDqWHnxLjX3Am//M0r3/vRz/C6TYXbdyoe79whpgudHPuZrECEXYG+y7yW+g4cQwPQugBEv6IMViaGMRKwuD9qIPPcLFBUrFE00Fc6Oc5uR8a55+eybBv8cuaVT+zt48/eaQycTxagrTzNiJ7P5r+4ShJKjINuGraMBkZOLLkLGl21jcBqfuT0sDP4Phbpg9//exjFNynFcMS79ysHuDF0+N8KQgInLAzsHfBCc9gJvZ41kC+KownPGSPKsSSCfGxgx5MVqHWxEnZgJhlDRN+G0T/0sR8/1Prb+ifg+AodbWbpMv8Y1/yn6ckWs/lpOI06NacYQLrIxHErMEgRH1f+Coifp7If93m+G4beB07V6g4XVptgC5l0pyNMq5BhH2BEzRngFOr7T3euAcJtKFk6Gpr0KGcoDGhC2EdvDWwsQnZMdQdTot3W5js/z04eN3L/+ljf5a9vOyupVGOf9BVzTbYGoYiipBXnff1rIkmLIuN2Nlgb33NZWjiGJoYI2++a3yb8kJrP4tk2+OarAph2yUNezkICEnPFvAthKCP8rG3BVOJoYkc8kDq6c6eiLimAUMhCpFwqCmElIkx3G/T/O5YsoG42dy/ZOrAxO70w/M9oiEytNxo1Ftv6s4YEWwRPbPizvgZgRjZh4ifJue/Y1O8+sws5UnWDUpa+F2XBdPlD+WEvRsQXftUEItgt6sfxpqm5/UAP1AyWEGEBRqaqK1Miw8XIl42pjNvkvOQ431XTGy77uGJn1z7cPlw/8qFtc7FqDmbUy31Ud3ZyFnWxBM5gqv5Ks1k+6lpnmVvvz+wZvO2zY884t4r5d8TB7RHUIRPhTBzFtsd/didnfZTBHvIk9sgQp/sstTvjEEjxDli1EhoFkllAsw00BjvW7f3u90LZo6Zn3/wE3hpyVq83vEBmyaxt67uYyfsDaEx1fRE/CIsvm+8f6Y5ffJAAfx7p/z7QgBaXlyI8oZgsRyeNqMJ4KA8XB4fP1HVFE5cb2Z3lCkb6AQqsIgyZk2iSY3Za8q7I2/w4vEjpjc7hQRNFzfH0XHFHXyk64M0mczDhOOazXDa+vxvIPRdMZWnt/wRhYh9eFjM9ELYp76MbHT08il/WVbgfCPogjHk1PLZw7UnJyf2Lrji+YnO+X/qmb6GFK/ZHGlQAlodsobEMDOJEXVoEqDiGlhz7Of80O5v8MN/83X/oRM/oQ5M0HQFr9cjfKuv/tafLaye+PbN8d797eds3kzutv53cuHfJQfMjpZppC1rYbqqQ/Sdj3fKbaPbTqmBmLwNp3697LqrKsgHe5tT5Z50kjryZsib54bRjGJx1qDsauiuT6I7f4V78tNI2MG4Rr63+8aDb9Lyp578g+U/aMv3yMgWuxPzefPoyvdF+d8YAlpDNq4bQXXxQ6jfNcQoAj9c+9XjUx858MrJG47snvzw3ufm3/zGL+Olk4eK8NEAzlpNsLZKZKHYg4HG23Tb0WcxePqVxnTUO9nMzKl78WwAVFfdiHsxdmxINmHsN1Krp/e9QnA7w//CSQLwz772ta6JJTdd+YvBm271iVm/9PiR2+/c9eOr7ti3LV59ZAxLTu33Xel0yC66iJDaGN6wVsPIwkkkqYa5k2D8Ggm+f7qz7/k3upbuf6Jz+8m5VJcR8LsnW/6uECBCQ2NjtnN6SLbdq9nfYqz++Z7bOe4YTm15LShZjNx39c2criw7sZ9uOvRL3LnvGX/r6z+RpJZp9ZtmKmWw0bKqZ8OeIk2JAw1Y1BDTyYaNfy0xfzMns7X7y9UT4dGbYLCjqF/S6Lmprr9dERAhbAzZYT/WKp1r/u6vNxyYL6V4BeJovTj6ZEdsl8d5hhoEp7oXYKrc42eSbk7LFZN3d+P6t7ZjoHocFdE0uEdmbUibZ1oYMRx3lLmEyPdTwy0O3q/LS41/Hf9y3Pa9SY+8NROy7O+TE+g9IoA3/GBv1FV9OW/b4zVbxgels/FRX5JPmDi+GZ4WGyHDminJNXXE3sH6jmYNffXT9gMTB3DrgR/jvp3fcstPHQQSMc2kLCQ+9yxaVjZJTNp4ULj1jJNNj33E8izF0VPxF6o/C3GXAl90WaTvhRPsZc7XckOg/FMIdh/X7TrRFYe+gfrd3pj7ifBb3NmVSLUG12jWnSJBvE08WKIyu0oFbySV2sly30GTVg8PHfpJHaf2z9OljKVFlikkVnISNEUy8kWmCRENxJ4GcvFlTYXU/10Slbi5g0ahItF4r5zAlwW+CG3Yi2g2a7NFbOzdbYjksy6R30OFP8KVOPG1GkTrp9Acjld29rlWEiML51J1n15rlJPHD105NFKPKxtdxI95a55z4sdVqrVQxBpRKoWJolybCJQRItEU1PUwMszEn6+76AH5He2lme1piDFyeVxNlzxzRNS8zbLYjfv2LciapdWW8DAZs54Sc5328viZpkcjV7/cMNmIrMbCBr6ealH5JGduV+SzZwcax5/4/ro7dulau/9g0cAHTo3fLywfI0NDbORKG1GXFkScppgEOSzUZTDGapsQkHqZ9JAtPqJvSEQ/6/zD2rFZOo2AL1Uc+NKgF1qxcoe2foRx68435/ms9KA19DkwfUIYy2EspKnRv+OQsyNxoo6/NjppsYb9IW/kSWfcFz1H31jSGe1rr379F4+fbLJ9ysF9meC/7kVeTB2cSnaovxtkMMTaIxRicC2TWu4hy/cYQ//CsPzDyX+PebOc0A/NHvxmusRQyHyLwwQ37Tk6P2/kH5GIP8PE91Ep6ZFcU3CSI3deGMzW2lDm1p9mmJS0eQhWk6n5D3fJ5I+walXo5Hr0KyOVR49+F7eOjtXaQtt4NL4ewHoYfiiJsUosLVSKa5VTCzKhryr0WBHHJdL6cQ7IFuflK5WEf0r/dqboB1FF4EPDkrx3DhChtbO9gYI1B8d7swwbYPBpCO6SyPYom3qvLVHeeN0WUaZk40oJkjWbXrLnAXzdOf7zLCo/3wZex6KjaBzYubw5d4cJ0v3e8BPw/k884Zs5yTFNOnLRd5ODKQAfmowMkKhACN1Clj+bOnlQvqhl1VaEsBVaJqP3aAUo/K22PM5r9kiSzbzxQRhejyhaC+J5XnIvmfPeawYKxFFkVUoVI25m5pgXeUmce5LI/GjH6itCIDO8aZN5+9Zbo22Dg9loqwYQNvkIIqyAp1EldOMN+TRON5Kkpi04LpP7bESDSYRE1W8alCO8dh9oSBpF1OcI93hP9XqttEe+0ngJj6KOx0Jp7pxex4tzgGiSWyt/QOf0Vlny+gvliI5f4xLc7SI35DvtPFcxcJyLo5y99eSMZF77MyMLn+dHxbtNgPmyZ/udFasWaM07DPUbtg0OKhfMKqnApiuCR3cmqvxfmJmR5i9M5v7EEH1VIHtDl1mLE5QjtENBgdNGsiiiHohoVml9Viuvxp/O7xhrV7c2FfMukwPAIMo1X3/Nnj19ady8A0wfBWQJU6Z9S144c6QtEOXYiFZl08xJrXnI5vx0Lu5b7Jf+bPcqSndrunuL2Oq60HiZqx9xDr+1tLYMw2BFsVkaxRSQvSZ/WMoaPu9VxrJMHwycwEDTQyvCXn+p3VhsaJEQf9SnbmpGZl6/5TFU8Rggj57bG3QhBFCBrF/NYswZs8jF9fsoSu5kcJfLZnQxFs61aTPnxBpOLFxWPwyirycN+nZWqr2+c1VICocRYoVZhXqBsfldNmqmD6Ij+e/s7XER+ecwtLrVMqgrmiwUNEUbxCpCWJPm5lTsZSuAY2cXes4WBXvOw0ZGCKF4OS3YJOaa+/Z2NBv+es/ZatPT2ZM3UkhW15y7pYrVomTs0My4WjtKkO+BzRPbb7462PcVr22Ky43lMjY0LcA6d1Hg2xstdALLCtDPphDRKOpA84D81/KTaaN5RSMTa2O+OrEUK7ayPIhOrhqILHUy5HpxWDM10nm4C9UJrIRXTpjtsTyvDhAhrFxZ9LFinZu/Ykc5dc1V3s7c4m064Ewd3urRJB81nO/w8P0GOc+85U3jL73P/2eKFw62l9u5clwmhx7na/Z+02DrRm14uXhzts7ZDIaKwvAKvuN3z+gFdE8cFXZ/IRH9pYMcpbLAaFtR0XTazirAM+YL6J44cncB3d14pMVVm4pGwwtzwPD8YoJam2PPV3zsr/fO3SAkiW82HbwPbcsFoXInual6pC81TfydE8tu/lVYQsRs1i4n+lw26+1c4mjZbQXazW3YeW0YMX1ODUC6c+ZLtiweqyDSDUPdRrsVHFh7SUPzmQ39dCsR016U0l8TcDos8mxA7Pn7BIuxZxZDJn49ycksEsMLtcADTVMrlwQrzGqH6uKxXzh/1ZdbD5FN5pcTW7uGjryYjl15Sw1nD6XAeZwTpc7ZjkuI+2fQhY7OSP5NbxV3/G4TT/y36eyk2+7YLIaXNSaiTnWHnApZ6J+lEkXSB6JesLbzt+qxi87lQIsLjNzUlMHUJ+8k0WimaFMvmkEZyLSPrwGYfIDT7L4rpr+wxlUPUy06FL/Z12zOa/yHBkw25Ru1k951vTnZ858nLqQHFPhgrp7o6UGJr4RJF8JSL/qoIxi7ejXFj7+ktbZu009XeC04NAXaRq5d9loQUySG2rEG2IQSXLjzXsPhZmh6Vf8W5IpeJ30rQF2Qws9NiPKrBdkAKL/bFyGgJrpIJM0ochQme7vbkvs/PfiLn06Cxtt6aGRE22ZGtX5/hi3/d08vKny7ZxlmG62BUZ86sEcUuq7DNogRSwmCbngqh7CRIMaCtGmmzWFCws0zffihT/CyEGCdZM6kk2CuhiVjfXshF/GpE+3Gs2Ioph6KbA+1XpTQLu9WoiZ0CytZPE99kMhN28ZrM/Plj35xgkaren/rutApMosA+SE64NyNIGxgoofQzwNh/+ost5gv9K04gOvaoayVJo9cK5DBWsMoiTQ0IdAECZ2KIxPyFmEsv2iPEIW4t30m/fW6n/JHADoCo2VRY8RnXlzTa9ewFnxIfVOvff1zxSv0TrUsTgZWGXX5WsCfTCemD6iHrbPKV54289MVMqvsuG+eY3c3kdzNRP1q/IIPp0u1l2/jN9QZlCgEtpp0kByxvpZAhmuizWv7yGAPKNfUWTGmL6FJCm2PKSQ9Nta8TXYhz7cT5EZjkl4Yb7SVNezAOZFcvOShMUKb/NuWlkJ/v9aIJRfEVIL460RkJVkXEhg6JkrHuePIzJlNJVmnNOh6Iro2vHNRk9CZX/h6LRR4rSoEtlZ30pBGHyqnmlPWtmh1CZ1/iwkvwtJr6OqaEakWynUrvMYG5/cDSEEYVT5W4M0xoMGV5i6R+nMijd2+Pu2DJxuk0msePxWN/gJNlB2UKYIGUkpIYFvSNxtCDcmR07edoll5T5ZW3kkRp2o2eI/qLocXTloN6Pqsojcs7FHC+wRMyEL0qc/RrKBGpplU2WI72L2AeZU9+OGbzXZUqO722VbGnkP/8DJPC9s06k8A1YHq77/mJX7KO09U9TeQMf1g6qLYJMTtfqe56wb/rLB3uYev51URvAyRX5AV7eMLYwFqfuZER8FwukiWTInPXiRDC30uH+aI5iEKXWpK61YPX4tmai9UFFQ/aM7VyTSaOAmSVxzT06aOXXTLsWCGZd35w3463413+O0ybPpPLVnoOpIbrI/uAfnbAbeGI7OArfJdYWmK11zaCFDdk0Gq9VS8vEgsm3xknulP/IF9+HLB2jLC2kaqhAsJzdu0F757iatoLxkPG6bbkaA3LB+p79XCcwhtpEjIT3r9+zpIdjiPMcPup0hkF07UTtAjrbT5u/gX5+eA9mgD/6tHI9Bj2WngCAhHepr/cdy67Lj4/JBPs6Vout6Qwix6fXPR111Ic5m+Cck0VTIOkl9FEZ4+VvrS7uAtzeGwuRSgBxRrU/vr3058KUr0JYK3UcMifaHAU2DywsgEt1dfPkDKIifgcVjl3fjsJdxf294GVrbA0r3IL5QVIlxsnB3ByUhpYCbrEy89xL5sSL3xAo5MVbaaoEjzFcoODXGSZUj9xKL+k2/tpM3peR8zJ1LbMgK77r6B+ch8H+BKMMLq6oaJ+RyyqXLMOUXma4CbRjQzUSCxvfWLp8QubYQEyYhVNxfvZ2wavmBAFN6IUtf3fQz9vVL+UpOilz5+4wv+7Y3LAZ4ub2Wdv4mxY4dZ1gF2g1Pkjna/Yw2zuLvFcm8W5+iWw0Er7nSgzWdC2wsDoI3SFvPBSJYU6590dLR1f3F74oARNN8U1CFYAI8D8BrtXQ7b/z8C90qhMD+bxwAAAABJRU5ErkJggg==',
      'buddy': 'data:image/png;base64,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',
      'workbuddy': 'data:image/png;base64,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',
      'qodercn': 'data:image/png;base64,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',
      'qoder': 'data:image/png;base64,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',
      'cline': 'data:image/png;base64,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',
      'raccoon': 'data:image/png;base64,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',
      'zcode': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAgklEQVR42u3XsRGAIAyF4UxgYe0g7j+FpZtgRwN36stLAhruqP+v4ICIdNaybsViy92yCj+CeMW7CO94gwgFRMUrIgFTAPbzgPe/Aa5nAInTAGicAtDE1QBtXAVgxGEAeuIpAFYYArDj81xEoQDLd+A1ID8k3wTkXDDEaDbEcBo1nl/XXoK4yMqvMgAAAABJRU5ErkJggg==',
    }

    /** The plugin's own brand mark (user-supplied artwork, 128px JPEG). */
    const BRAND_ICON = 'data:image/jpeg;base64,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'

    /**
     * The fourteen account channels enabled by OFM. Identity is static (it is
     * the product, not a reading), so the grid renders instantly and only the
     * *state* comes from the pack over RPC. `accent` drives each card's stripe
     * and logo tile; `login` picks the flow the card offers.
     */
    const CHANNEL_PROVIDERS = [
      { id: 'codearts', name: 'CodeArts', org: '华为云', accent: '#C7000B', note: 'DeepSeek · GLM · openPangu，每日免费额度', login: 'browser' },
      { id: 'buddy', name: 'WorkBuddy 国内版', org: '腾讯 · copilot.tencent.com', accent: '#0A7AFF', note: 'CodeBuddy 同一端点：DeepSeek · Kimi · GLM 免费线，每日积分', login: 'browser' },
      { id: 'workbuddy', name: 'WorkBuddy 国际版', org: '腾讯 · workbuddy.ai', accent: '#0B63CE', note: '国际版端点：独立账号与积分体系', login: 'browser' },
      { id: 'lobsterai', name: 'LobsterAI', org: '有道', accent: '#FF6A00', note: '龙虾 · 每日签到积分', login: 'browser' },
      { id: 'qoder', name: 'Qoder', org: '阿里系', accent: '#615CED', note: '每日 100 Credits，加密推理端点', login: 'browser' },
      { id: 'qodercn', name: 'Qoder 中国版', org: '阿里系', accent: '#7A6CF0', note: '中国版端点与模型池', login: 'browser' },
      { id: 'trae', name: 'TRAE', org: '字节', accent: '#00BFA6', note: '手机号登录', login: 'browser' },
      { id: 'cline', name: 'Cline', org: 'Cline', accent: '#5B5BD6', note: 'Cline 账号免费额度', login: 'browser' },
      { id: 'loomy', name: 'Loomy', org: '讯飞', accent: '#2F6BFF', note: '微信扫码，或短信验证码备用', login: 'browser+sms' },
      { id: 'raccoon', name: 'Raccoon', org: '商汤', accent: '#00A6A6', note: '手机号登录', login: 'browser' },
      { id: 'minimax', name: 'MiniMax Code', org: 'MiniMax', accent: '#E4007F', note: '设备码 + PKCE，每日签到', login: 'browser' },
      { id: 'zcode', name: 'ZCode', org: '智谱', accent: '#3B6EF6', note: '浏览器登录（需本机可开浏览器）', login: 'browser' },
      { id: 'gemini', name: 'Gemini', org: 'Google Code Assist', accent: '#4285F4', note: '本地回调 OAuth 免费线', login: 'browser' },
      { id: 'officeace', name: 'OfficeAce', org: '华为云 ModelArts MaaS', accent: '#C7000B', note: '华为云 OAuth（PKCE + DPoP），云端直连、无需装客户端', login: 'browser' },
      { id: 'accio', name: 'Accio Work', org: '阿里', accent: '#FF6A00', note: '标准 OAuth + PKCE（公开客户端），可脱离 IDE 使用', login: 'browser' },
    ]

    /**
     * 把渠道按「是否已接入账号」分成两组：**已接入在前、未接入在后**，
     * 各自保持 `PROVIDERS` 里的原始相对顺序。
     *
     * ## 为什么抽成纯函数（2026-11-11）
     *
     * 卡片顺序是被用户直接看见的行为，值得一条**顺序语义**的回归钉子；
     * 而频道页要经 RPC 才拿到 `statuses`，渲染测试的替身里没有 connection，
     * 永远停在「未就绪」态（那一态刻意不分组）。⇒ 抽出来让套件直接测语义，
     * 而不是为了测顺序去伪造一整套 RPC。
     *
     * ⚠️ `statuses === undefined`（还没拉到数据）→ **不分组**：那时所有卡都是
     * 骨架态，硬分会让人看到列表在一次数据到达后整体跳动。
     * ⚠️ 「已接入」判据与卡片绿点/计数**必须同一个**（`accounts.enabled > 0`）。
     */
    function groupChannelsByConnected(providers, statuses, labels) {
      if (statuses === undefined) return [{ key: 'all', label: null, dot: null, rows: providers }]
      const isOn = row => (statuses?.[row.id]?.accounts?.enabled ?? 0) > 0
      return [
        { key: 'on', label: labels.on, dot: 'on', rows: providers.filter(isOn) },
        { key: 'off', label: labels.off, dot: 'off', rows: providers.filter(row => !isOn(row)) },
      ].filter(group => group.rows.length > 0)
    }

    /** 与现有 RPC 的能力对应：余额、每日领取及独立签到状态分别判断。 */
    const CHANNEL_CREDITS = {
      codearts: { claim: true },
      buddy: { claim: true, status: true },
      workbuddy: {},
      lobsterai: { claim: true },
      qoder: { claim: true },
      qodercn: { claim: true },
      trae: { claim: true },
      cline: { unit: 'dollars' },
      loomy: { claim: true },
      raccoon: {},
      minimax: { claim: true, status: true },
      zcode: { claim: true, unit: 'tokens' },
      gemini: { unit: 'quota', quota: true },
      // ⚠️ `claim` **刻意不登记**：OfficeAce 的签到走云侧自动领取
      //（拉余额时完成），手动领取 RPC 对它没有意义 —— 登记了会渲染一个无效按钮。
      officeace: {},
      // ⚠️ 只有余额可查：上游 registry 登记 `dailyCheckin: false`（无手动签到端点），
      // 且不参与限流按钮与永久积分锁定 ⇒ 与 raccoon / officeace 同形（空对象 = 仅余额）。
      accio: {},
    }

    /**
     * The host RPC the pack registered at `/api/channel-pack`.
     *
     * The pack's own browser half used the shell's connection service; this page
     * does the same instead of proxying through our JSON API, so channel traffic
     * keeps the connection's admission and the credential store stays the only
     * place a token exists. `connection` is read opportunistically: a shell that
     * does not offer it still renders the free and EAC pages, with this one
     * explaining itself instead of breaking.
     */
    function useChannelRpc(ctx) {
      return useMemo(() => {
        let connection
        try { connection = ctx?.connection } catch { connection = undefined }
        if (connection === undefined && typeof ctx?.get === 'function') {
          try { connection = ctx.get('connection') } catch { connection = undefined }
        }
        const rpc = async (method, payload, timeoutMs = 60_000) => {
          if (connection?.rpc?.call === undefined) throw new Error('no-connection')
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          try {
            const result = await connection.rpc.call('/api', 'channel-pack', { method, payload }, controller.signal)
            if (result?.ok === true) return result.value
            if (result?.ok === false) throw new Error(result.error?.message ?? result.error?.code ?? 'rpc-failed')
            return result
          } finally { clearTimeout(timer) }
        }
        return { available: connection?.rpc?.call !== undefined, rpc }
      }, [ctx])
    }

    /** Human text for a millisecond timestamp, or the long-lived marker. */
    function expiryText(entry, t) {
      if (!Number.isFinite(entry?.expiresAt) || entry.expiresAt <= 0) return t('chan.expires.never')
      return ago(entry.expiresAt, t.locale)
    }

    function ChannelCard(props) {
      const { channel, status, rpc, t, onError, onChanged } = props
      const [open, setOpen] = useState(null)
      const [accounts, setAccounts] = useState(undefined)
      const [models, setModels] = useState(undefined)
      const [credits, setCredits] = useState(undefined)
      // 实时积分：每个账号的剩余余额（credits.balances），卡片汇总 + 账号行
      // 逐条展示；随账号列表与领积分动作刷新，另有一个慢轮询兜底。
      const [balances, setBalances] = useState(undefined)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')
      const [login, setLogin] = useState(null)
      const modelBatchPending = useRef(false)
      const [balanceError, setBalanceError] = useState('')
      const [balanceLoading, setBalanceLoading] = useState(false)
      const balancePending = useRef(null)
      const balanceGeneration = useRef(0)
      const claimPending = useRef(false)
      const creditCapability = CHANNEL_CREDITS[channel.id]
      const balanceLabel = creditCapability?.unit === 'tokens' ? t('chan.credits.tokens')
        : creditCapability?.unit === 'dollars' ? t('chan.credits.dollars')
          : creditCapability?.quota ? t('chan.credits.quota') : t('chan.credits.left')

      const accountsCount = status?.accounts?.total ?? 0
      const enabledCount = status?.accounts?.enabled ?? 0
      const modelsTotal = status?.models?.total ?? 0
      const modelsOff = status?.models?.disabled ?? 0
      const connected = enabledCount > 0
      const chanState = status?.closed === true ? 'off' : connected ? 'on' : 'idle'
      const stateText = status?.closed === true ? t('chan.state.closed') : connected ? t('chan.state.on') : t('chan.state.off')

      const loadAccounts = useCallback(async () => {
        try {
          const value = await rpc('account.list', { provider: channel.id })
          setAccounts(value?.accounts ?? [])
        } catch (error) { setAccounts([]); onError(channel, error) }
      }, [rpc, channel.id, onError])
      const loadModels = useCallback(async () => {
        try {
          const value = await rpc('model.list', { provider: channel.id })
          setModels(value?.models ?? [])
        } catch (error) { setModels([]); onError(channel, error) }
      }, [rpc, channel.id, onError])
      const loadCredits = useCallback(async () => {
        if (!CHANNEL_CREDITS[channel.id]?.status) return
        try {
          const value = await rpc('credits.status', { provider: channel.id })
          setCredits(value?.accounts ?? [])
        } catch { setCredits([]) }
      }, [rpc, channel.id])
      const loadBalances = useCallback((afterWrite = false) => {
        if (!CHANNEL_CREDITS[channel.id] || !rpc) return Promise.resolve()
        const pending = balancePending.current
        if (!afterWrite && pending?.provider === channel.id && pending.rpc === rpc) return pending.promise
        const generation = ++balanceGeneration.current
        const request = { provider: channel.id, rpc }
        balancePending.current = request
        setBalanceLoading(true); setBalanceError('')
        request.promise = (async () => {
          try {
            const value = await rpc('credits.balances', { provider: channel.id, ...afterWrite ? { force: true } : {} }, 90_000)
            if (generation === balanceGeneration.current) setBalances(value?.accounts ?? [])
          } catch (error) {
            if (generation === balanceGeneration.current) {
              setBalances([])
              setBalanceError(String(error?.message ?? error))
            }
          } finally {
            if (generation === balanceGeneration.current) setBalanceLoading(false)
            if (balancePending.current === request) balancePending.current = null
          }
        })()
        return request.promise
      }, [rpc, channel.id])
      useEffect(() => {
        setBalances(undefined); setBalanceError('')
        void loadBalances()
        return () => { balanceGeneration.current++; balancePending.current = null }
      }, [loadBalances])
      // A slow heartbeat keeps the numbers honest while the page sits open:
      // balances move whenever a model is used elsewhere, and a stale credit
      // count reads as "I have more quota than I do".
      useEffect(() => {
        if (!CHANNEL_CREDITS[channel.id]) return undefined
        const timer = setInterval(() => { void loadBalances() }, 90_000)
        return () => clearInterval(timer)
      }, [channel.id, loadBalances])
      const balanceOf = accountId => {
        const row = (balances ?? []).find(entry => entry.accountId === accountId)
        return row?.balance === null || row?.balance === undefined ? null : row.balance
      }
      const balancesTotal = (balances ?? []).reduce((sum, row) => sum + (Number.isFinite(row.balance?.total) ? row.balance.total : 0), 0)
      const balancesKnown = (balances ?? []).some(row => Number.isFinite(row.balance?.total))
      const balanceFailures = (balances ?? []).filter(row => row.error || !Number.isFinite(row.balance?.total)).length

      // Refetch what is on screen whenever the pack reports a change for this
      // channel: an account added in another tab, a completed background login,
      // a claim that moved the numbers.
      useEffect(() => {
        const onEvent = () => {
          if (open === 'accounts') { void loadAccounts(); void loadCredits() }
          if (open === 'models') void loadModels()
          void loadBalances()
        }
        window.addEventListener('ofm:channels', onEvent)
        return () => window.removeEventListener('ofm:channels', onEvent)
      }, [open, loadAccounts, loadModels, loadCredits, loadBalances])

      const toggle = async fold => {
        if (open === fold) { setOpen(null); return }
        setOpen(fold)
        if (fold === 'accounts') { setAccounts(undefined); await loadAccounts(); void loadCredits(); void loadBalances() }
        if (fold === 'models') { setModels(undefined); await loadModels() }
      }

      // The pack's login is two-phase: `account.create` returns the URL to open
      // *immediately* (a popup opened after a 30-second await is blocked), then
      // the browser flow finishes in the background and `login.poll` sees the
      // credential appear. The placeholder account is real from the first
      // moment, so the card can poll against it.
      const startLogin = async () => {
        setBusy('add'); setNotice('')
        try {
          const value = await rpc('account.create', { provider: channel.id }, 90_000)
          const accountId = value?.accountId
          const url = value?.loginUrl
          if (typeof accountId !== 'string' || accountId === '') throw new Error('bad-answer')
          if (typeof url === 'string' && url !== '') {
            try { window.open(url, '_blank', 'noopener') } catch { /* the modal offers the link too */ }
          }
          setLogin({ accountId, url: typeof url === 'string' ? url : '', startedAt: Date.now() })
          setOpen('accounts')
        } catch (error) { onError(channel, error) } finally { setBusy('') }
      }

      // Poll the placeholder until its credential lands. Ten minutes matches the
      // window the pack keeps a pending login link alive for.
      useEffect(() => {
        if (login === null) return undefined
        let alive = true
        const timer = setInterval(async () => {
          if (Date.now() - login.startedAt > 10 * 60_000) {
            if (alive) { setLogin(null); setNotice(t('chan.login.expired')) }
            return
          }
          try {
            const value = await rpc('login.poll', { accountId: login.accountId, provider: channel.id })
            if (!alive) return
            if (value?.done === true) {
              setLogin(null)
              if (value.success === false) {
                setNotice(t('chan.login.failed').replace('{reason}', value.error ?? '未知原因'))
              } else {
                setNotice(t('chan.login.done').replace('{login}', value.login ?? ''))
                onChanged()
                void loadAccounts()
                void loadCredits()
                void loadBalances(true)
              }
            } else if (typeof value?.error === 'string' && value.error !== '') {
              setLogin(null)
              setNotice(t('chan.login.failed').replace('{reason}', value.error))
            }
          } catch { /* the link may still complete; keep polling */ }
        }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [login, rpc, channel.id, t, onChanged, loadAccounts, loadCredits, loadBalances])

      const accountAction = async (key, accountId, fn) => {
        setBusy(key); setNotice('')
        try { await fn() } catch (error) { onError(channel, error) } finally { setBusy('') }
      }

      const setAllModels = async disabled => {
        if (busy !== '' || modelBatchPending.current || !rpc || !models?.length) return
        modelBatchPending.current = true
        try {
          await accountAction(disabled ? 'models:hide' : 'models:show', '', async () => {
            await rpc('model.setAllDisabled', { provider: channel.id, disabled })
            await loadModels()
            onChanged()
          })
        } finally { modelBatchPending.current = false }
      }

      const removeAccount = async accountId => {
        const entry = (accounts ?? []).find(row => row.id === accountId)
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm(t('chan.confirm.delete').replace('{name}', entry?.nickname ?? accountId))) return
        await accountAction('del:' + accountId, accountId, async () => {
          await rpc('account.delete', { accountId })
          onChanged(); await loadAccounts(); void loadBalances(true)
        })
      }

      const claim = async () => {
        if (!creditCapability?.claim || busy !== '' || claimPending.current) return
        claimPending.current = true
        setBusy('claim'); setNotice('')
        try {
          const value = await rpc('credits.claimAll', { provider: channel.id }, 180_000)
          const summary = value?.summary ?? value
          const claimed = Number(summary?.claimed ?? 0)
          const credit = Number(summary?.totalCredit ?? 0)
          const failed = (value?.results ?? []).filter(row => row.outcome?.kind === 'failed')
          const successText = t('chan.claim.result').replace('{count}', String(claimed)).replace('{credit}', String(credit))
          const failureText = t('chan.claim.failed').replace('{reason}', failed.map(row => row.outcome.message).join('；'))
          setNotice(failed.length > 0 ? claimed > 0 ? `${successText}；${failureText}` : failureText
            : claimed > 0 ? successText : t('chan.claim.none'))
          void loadCredits(); void loadBalances(true)
        } catch (error) { onError(channel, error) } finally { claimPending.current = false; setBusy('') }
      }

      const creditFor = accountId => (credits ?? []).find(row => row.accountId === accountId)?.status ?? null

      const card = h('article', {
        className: `ofm_chan ofm_glass${status?.closed === true ? ' off' : ''}`,
        'data-state': chanState,
        style: { '--chan-accent': channel.accent },
      },
        h('div', { className: 'ofm_chanhead' },
          h('span', { className: 'ofm_chanlogo', 'aria-hidden': 'true' },
            CHANNEL_ICONS[channel.id] !== undefined
              ? h('img', { src: CHANNEL_ICONS[channel.id], alt: '' })
              : channel.name.slice(0, 2).toUpperCase()),
          h('span', { className: 'ofm_chanid' },
            h('b', null, channel.name),
            h('span', null, channel.org)),
          h('span', { className: 'ofm_chanstate' },
            h('span', { className: `ofm_dot ${connected ? 'ok' : status?.closed === true ? 'err' : ''}` }),
            stateText)),
        h('p', { className: 'ofm_note' }, channel.note),
        h('div', { className: 'ofm_chanmeta' },
          h('span', null, `${t('chan.meta.accounts')} `, h('b', null, `${enabledCount}/${accountsCount}`)),
          h('span', null, `${t('chan.meta.models')} `, h('b', null, modelsTotal === 0 ? '—' : `${modelsTotal - modelsOff}/${modelsTotal}`)),
          creditCapability ? h('span', { className: 'ofm_credittotal' },
            `${balanceLabel} `,
            h('b', null, balanceLoading ? '…' : balancesKnown
              ? creditCapability.quota ? t('chan.credits.loaded').replace('{count}', String((balances ?? []).filter(row => Number.isFinite(row.balance?.total)).length)) : kilo(balancesTotal)
              : balances === undefined ? '…' : '—')) : null),
        h('div', { className: 'ofm_chanacts' },
          h('button', { type: 'button', className: 'ofm_btn', disabled: busy !== '' || !rpc, 'aria-busy': busy === 'add' ? 'true' : undefined, onClick: startLogin }, busy === 'add' ? '…' : t('chan.act.add')),
          accountsCount > 0 ? h('button', {
            type: 'button', className: 'ofm_btn ghost', disabled: busy !== '' || !rpc, 'aria-busy': busy === 'refreshAll' ? 'true' : undefined,
            onClick: () => accountAction('refreshAll', '', async () => {
              for (const row of accounts ?? await rpc('account.list', { provider: channel.id }).then(v => v?.accounts ?? [])) {
                try { await rpc('account.refresh', { accountId: row.id }, 90_000) } catch (error) { onError(channel, error) }
              }
              onChanged(); await loadAccounts(); void loadBalances(true)
            }),
          }, busy === 'refreshAll' ? '…' : t('chan.act.refresh')) : null,
          creditCapability ? h('button', {
            type: 'button', className: 'ofm_btn ghost', disabled: balanceLoading || busy !== '' || !rpc,
            'aria-busy': balanceLoading ? 'true' : undefined, onClick: () => void loadBalances(true),
          }, balanceLoading ? t('chan.credits.loading') : t('chan.credits.refresh')) : null,
          creditCapability?.claim ? h('button', {
            type: 'button', className: 'ofm_btn ghost', disabled: busy !== '' || !rpc, 'aria-busy': busy === 'claim' ? 'true' : undefined,
            onClick: claim,
          }, busy === 'claim' ? '…' : t('chan.act.claim')) : null,
          h('button', { type: 'button', className: 'ofm_foldtoggle', 'data-open': open === 'accounts' ? 'true' : 'false', onClick: () => void toggle('accounts') },
            h('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, h('path', { d: 'M3 1.5l6 4.5-6 4.5z' })),
            t('chan.fold.accounts'), accounts === undefined ? null : ` (${accounts.length})`),
          h('button', { type: 'button', className: 'ofm_foldtoggle', 'data-open': open === 'models' ? 'true' : 'false', onClick: () => void toggle('models') },
            h('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, h('path', { d: 'M3 1.5l6 4.5-6 4.5z' })),
            t('chan.fold.models'), models === undefined ? null : ` (${models.length})`)),
        notice !== '' ? h('p', { className: 'ofm_note' }, notice) : null,
        balanceError !== '' ? h('p', { className: 'ofm_balanceerror', role: 'alert' },
          t('chan.credits.failed').replace('{reason}', balanceError))
          : balanceFailures > 0 ? h('p', { className: 'ofm_balanceerror', role: 'status' },
            t('chan.credits.partial').replace('{count}', String(balanceFailures))) : null,
        open === 'accounts' ? h('div', { className: 'ofm_chanfold' },
          accounts === undefined ? h('div', { className: 'ofm_skel', style: { minHeight: 44 } })
            : accounts.length === 0 ? h('p', { className: 'ofm_note' }, t('chan.noAccount'))
              : h('div', { className: 'ofm_acctlist' }, accounts.map(row => {
                const credit = creditFor(row.id)
                const pending = row.refreshable !== true && !Number.isFinite(row.expiresAt)
                return h('div', { className: 'ofm_acct' + (pending ? ' pending' : ''), key: row.id },
                  h('span', { className: 'ofm_acctname', title: row.nickname ?? row.id }, row.nickname ?? row.id),
                  h('span', { className: 'ofm_acctmeta' }, row.enabled === false ? t('chan.disabled') : t('chan.enabled'), ' · ', expiryText(row, t)),
                  credit?.todayCheckedIn === true && Number.isFinite(credit.todayCredit) ? h('span', { className: 'ofm_creditbadge' },
                    t('chan.credit.today').replace('{credit}', String(credit.todayCredit))) : null,
                  (() => {
                    const balance = balanceOf(row.id)
                    if (!creditCapability) return null
                    if (balanceLoading) return h('span', { className: 'ofm_note' }, t('chan.credits.loading'))
                    const result = (balances ?? []).find(entry => entry.accountId === row.id)
                    if (balance === null || !Number.isFinite(balance.total)) return h('span', { className: 'ofm_balanceerror' },
                      balanceError ? t('chan.credits.failed').replace('{reason}', balanceError)
                        : result?.error || t('chan.credits.unavailable'))
                    const reading = creditCapability.quota
                      ? (balance.packages ?? []).map(pkg => `${pkg.name} ${pkg.remaining}%`).join(' · ') || '—'
                      : kilo(balance.total)
                    return h('span', { className: 'ofm_creditbadge strong', title: balanceLabel },
                      `${balanceLabel} ${reading}`)
                  })(),
                  h('span', { className: 'ofm_acctacts' },
                    h('button', {
                      type: 'button', className: 'ofm_minibtn', disabled: busy !== '' || !rpc,
                      onClick: () => accountAction('test:' + row.id, row.id, async () => {
                        const value = await rpc('account.test', { accountId: row.id }, 90_000)
                        setNotice(value?.ok === false
                          ? t('chan.test.failed').replace('{reason}', value?.error ?? '')
                          : t('chan.test.ok').replace('{ms}', String(value?.ms ?? value?.latencyMs ?? '—')))
                      }),
                    }, t('chan.act.test')),
                    h('button', {
                      type: 'button', className: 'ofm_minibtn', disabled: busy !== '' || !rpc,
                      onClick: () => accountAction('refresh:' + row.id, row.id, async () => {
                        await rpc('account.refresh', { accountId: row.id }, 90_000)
                        onChanged(); await loadAccounts(); void loadBalances(true)
                      }),
                    }, t('chan.act.refresh')),
                    h('button', {
                      type: 'button', className: 'ofm_minibtn', disabled: busy !== '' || !rpc,
                      onClick: () => accountAction('toggle:' + row.id, row.id, async () => {
                        await rpc('account.update', { accountId: row.id, patch: { enabled: row.enabled === false } })
                        onChanged(); await loadAccounts()
                      }),
                    }, row.enabled === false ? t('chan.enabled') : t('chan.disabled')),
                    h('button', {
                      type: 'button', className: 'ofm_minibtn danger', disabled: busy !== '' || !rpc,
                      onClick: () => void removeAccount(row.id),
                    }, t('chan.act.delete'))))
              }))) : null,
        open === 'models' ? h('div', { className: 'ofm_chanfold' },
          models === undefined ? h('div', { className: 'ofm_skel', style: { minHeight: 44 } })
            : models.length === 0 ? h('p', { className: 'ofm_note' }, '—')
              : h(Fragment, null,
                h('div', { className: 'ofm_row' },
                  h('span', { className: 'ofm_note' }, t('chan.model.enabledCount')
                    .replace('{enabled}', String(models.filter(model => model.disabled !== true).length))
                    .replace('{total}', String(models.length))),
                  h('button', {
                    type: 'button', className: 'ofm_btn ghost', disabled: busy !== '' || !rpc,
                    title: t('chan.model.allScope'), 'aria-busy': busy === 'models:show' ? 'true' : undefined,
                    onClick: () => void setAllModels(false),
                  }, t('chan.model.enableAll')),
                  h('button', {
                    type: 'button', className: 'ofm_btn ghost', disabled: busy !== '' || !rpc,
                    title: t('chan.model.allScope'), 'aria-busy': busy === 'models:hide' ? 'true' : undefined,
                    onClick: () => void setAllModels(true),
                  }, t('chan.model.disableAll'))),
                h('div', { className: 'ofm_modellist' }, models.map(model => h('div', {
                className: 'ofm_modelrow' + (model.disabled === true ? ' off' : ''),
                key: model.id,
              },
                h('span', { className: 'ofm_id', title: model.id }, model.name ?? model.id),
                model.isFree === true ? h('span', { className: 'ofm_tagpill free' }, t('chan.model.free')) : null,
                model.dead === true ? h('span', { className: 'ofm_tagpill dead' }, t('chan.model.dead')) : null,
                h('button', {
                  type: 'button', className: 'ofm_minibtn', disabled: busy !== '' || !rpc,
                  onClick: () => accountAction('model:' + model.id, '', async () => {
                    await rpc('model.setDisabled', { provider: channel.id, modelId: model.id, disabled: model.disabled !== true })
                    await loadModels(); onChanged()
                  }),
                }, model.disabled === true ? t('chan.model.on') : t('chan.model.off'))))))) : null)

      const modal = login === null ? null : h('div', { className: 'ofm_scrim' },
        h('div', { className: 'ofm_modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('chan.login.title').replace('{name}', channel.name) },
          h('div', { className: 'ofm_modalhead' }, t('chan.login.title').replace('{name}', channel.name)),
          h('div', { className: 'ofm_modalbody ofm_loginbody' },
            h('div', { className: 'ofm_loginstep' }, h('b', null, '1'), h('span', null, t('chan.login.step1'))),
            h('div', { className: 'ofm_loginstep' }, h('b', null, '2'), h('span', null, t('chan.login.step2'))),
            login.url === '' ? null : h('code', { className: 'ofm_mono', style: { wordBreak: 'break-all', whiteSpace: 'pre-wrap' } }, login.url),
            h('p', { className: 'ofm_note ofm_scanline' }, t('chan.login.waiting'))),
          h('div', { className: 'ofm_modalfoot' },
            login.url === '' ? null : h('a', { className: 'ofm_btn primary', href: login.url, target: '_blank', rel: 'noreferrer noopener' }, t('chan.login.open')),
            h('button', { type: 'button', className: 'ofm_btn ghost', onClick: () => setLogin(null) }, t('chan.login.cancel')))))

      return h(Fragment, null, card, modal)
    }

    function ChannelsPage(props) {
      const { t, ctx, summary } = props
      const { available, rpc } = useChannelRpc(ctx)
      // The pack runs a daily auto check-in engine across the credit channels;
      // this page is where it is switched and watched (usage.autoCheckin).
      const [auto, setAuto] = useState(undefined)
      const loadAuto = useCallback(async () => {
        if (!available) return
        try { const value = await rpc('usage.autoCheckin', {}, 30_000); setAuto(value?.autoCheckin ?? null) } catch { setAuto(null) }
      }, [available, rpc])
      useEffect(() => { void loadAuto() }, [loadAuto])
      const toggleAuto = async () => {
        try { const value = await rpc('usage.autoCheckin', { enabled: auto?.enabled !== true }, 60_000); setAuto(value?.autoCheckin ?? null) } catch { /* the status refresh tells */ }
      }
      const [statuses, setStatuses] = useState(undefined)
      const [error, setError] = useState('')
      const pack = summary?.channels ?? { state: 'pending', error: '' }
      // The pack is what answers this page's RPC, so *the RPC answering* is the
      // readiness signal — the summary's `channels` bit can be a step behind:
      // it is read when the page mounts, while the pack's dynamic import may
      // still be in flight, and a page that trusted it would show an empty grid
      // for as long as that stale read lasted. The summary state is then only
      // the failure *reason* when the probes never come back.
      const [ready, setReady] = useState(pack.state === 'ready')

      const loadStatus = useCallback(async (attempt = 0) => {
        if (!available) return
        try {
          const value = await rpc('provider.status', { providers: CHANNEL_PROVIDERS.map(row => row.id) })
          setStatuses(value?.statuses ?? {})
          setReady(true)
          setError('')
        } catch (err) {
          // The pack imports asynchronously on a cold start; retry a bounded
          // few times before believing the failure and surfacing the reason.
          if (attempt < 4) { setTimeout(() => { void loadStatus(attempt + 1) }, 4000); return }
          setError(String(err?.message ?? err))
        }
      }, [available, rpc])

      useEffect(() => { void loadStatus() }, [loadStatus])
      // A second poll loop, slow: the pack pushes nothing for accounts changed
      // in another window, and a stale count on this page is the kind of quiet
      // wrongness that reads as a bug. Local actions refresh immediately.
      useEffect(() => {
        if (!available) return undefined
        const timer = setInterval(() => { void loadStatus() }, 45_000)
        return () => clearInterval(timer)
      }, [available, loadStatus])

      const onChanged = useCallback(() => {
        void loadStatus()
        try { window.dispatchEvent(new CustomEvent('ofm:channels')) } catch { /* no window */ }
      }, [loadStatus])

      const onError = useCallback((channel, err) => {
        const reason = String(err?.message ?? err)
        showToast({ title: t('chan.error').replace('{reason}', reason).slice(0, 120), body: channel.name, tone: 'warn' })
      }, [t])

      const connected = statuses === undefined ? 0 : CHANNEL_PROVIDERS.filter(row => (statuses[row.id]?.accounts?.enabled ?? 0) > 0).length
      const failed = !ready && pack.state === 'failed'
      /**
       * **渠道分组**（2026-11-11 用户要求）：「已接入账号的一组、未接入的一组；
       * 已接入的上移、未接入的不动」。
       *
       * ⚠️ 顺序判据：`CHANNEL_PROVIDERS` 是**硬编码**的产品顺序（codearts → buddy →
       * … → accio），这是有意的品牌编排，不能在数组里就地重排（否则以后维护
       * 看不出原始顺序）。
       * ⇒ 渲染时**派生成两组**：`filter` 保持各自在源数组里的相对顺序，
       *   「已接入」在前、「未接入」在后 —— 正好是「上移 + 未动的保持原序」。
       *
       * ⚠️ 「已接入」判据与卡片上的绿点/计数**必须同一个**（`accounts.enabled > 0`）：
       * 用别的判据（如 `accounts.total`）会出现「卡片显示未接入却排在已接入组」。
       *
       * ⚠️ `statuses === undefined`（还没拉到数据）时**不分组**：那时所有卡都是
       * 骨架态，硬分会让人看到列表在一次数据到达后整体跳动。
       */
      const channelGroups = groupChannelsByConnected(CHANNEL_PROVIDERS, statuses, {
        on: t('chan.group.on'),
        off: t('chan.group.off'),
      })

      return h('div', { className: 'ofm_page' },
        h('header', { className: 'ofm_hero ofm_glass' },
          h('div', { className: 'ofm_pagehead' },
            h('div', { className: 'ofm_pagetitle' },
              h('h2', null, t('chan.title')),
              h('p', { className: 'ofm_pagesub' }, t('chan.sub'))),
            h('div', { className: 'ofm_pills' },
              h(Pill, { strong: true, tone: ready ? 'ok' : failed ? 'err' : 'warn' },
                ready ? `${connected}/${CHANNEL_PROVIDERS.length} ${t('chan.state.on')}` : t('chan.state.off')),
              h(Pill, null, `${t('chan.meta.accounts')} ${statuses === undefined ? '—' : CHANNEL_PROVIDERS.reduce((sum, row) => sum + (statuses[row.id]?.accounts?.enabled ?? 0), 0)}`))),
          auto == null ? null : h('div', { className: 'ofm_row' },
            h(Switch, { checked: auto.enabled === true, label: t('chan.auto.title'), onChange: () => void toggleAuto() }),
            h(Pill, { tone: auto.running === true ? 'warn' : auto.ranToday === true ? 'ok' : '' },
              auto.running === true ? t('chan.auto.running') : auto.ranToday === true ? t('chan.auto.ran') : t('chan.auto.off')),
            typeof auto.lastResult === 'string' && auto.lastResult !== '' ? h('span', { className: 'ofm_note', title: auto.lastResult }, t('chan.auto.last').replace('{result}', auto.lastResult.length > 60 ? `${auto.lastResult.slice(0, 60)}…` : auto.lastResult)) : null)),
        failed ? h('div', { className: 'ofm_callout ofm_error' },
          h('div', null, t('chan.pack.failed').replace('{reason}', pack.error ?? ''), h('div', { className: 'ofm_note' }, t('chan.pack.hint')))) : null,
        !available ? h('div', { className: 'ofm_callout' }, h('div', null, t('chan.rpc.unavailable'))) : null,
        !ready ? h('div', { className: 'ofm_chanwrap' },
          [0, 1, 2].map(index => h('div', { className: 'ofm_skel', key: index, style: { minHeight: 168 } }))) : null,
        ready ? h('div', { className: 'ofm_chanwrap' },
          channelGroups.flatMap(group => [
            group.label === null ? null : h('div', { className: 'ofm_chargroup', key: `g-${group.key}` },
              h('span', { className: `ofm_chargroupdot ${group.dot === 'off' ? 'off' : ''}`.trim() }),
              h('span', null, group.label),
              h('span', { className: 'ofm_chargroupn' }, String(group.rows.length))),
            ...group.rows.map(channel => h(ChannelCard, {
              key: channel.id,
              channel,
              status: statuses?.[channel.id],
              rpc: available ? rpc : null,
              t,
              onError,
              onChanged,
            })),
          ].filter(Boolean))) : null,
        error !== '' && !failed ? h('p', { className: 'ofm_note' }, `${t('chan.error').replace('{reason}', error)}`) : null)
    }

    // ── 数据看板 / 运行日志 / 网关设置 ────────────────────────────────────────
    // The absorbed pack keeps a per-request token ledger (channel → provider →
    // account → model trees, plus a ring of individual requests). These three
    // pages are its reading surface, modelled on the standalone gateway
    // consoles users already know: KPI cards, an account pivot, a model
    // performance table, a paginated request log and the gateway's switches.
    const LEDGER_EMPTY = () => ({ requests: 0, reportedRequests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, errors: 0 })

    /** Weighted merge of tree rows: averages are re-weighted by request count
     *  so a cross-day or cross-account merge never pretends a heavy day and a
     *  light day average to their mean. */
    function mergeLedgerRows(rows) {
      const out = LEDGER_EMPTY()
      let ttftSum = 0; let ttftN = 0; let tpsSum = 0; let tpsN = 0
      for (const row of rows) {
        out.requests += row.requests ?? 0
        out.reportedRequests += row.reportedRequests ?? 0
        out.inputTokens += row.inputTokens ?? 0
        out.outputTokens += row.outputTokens ?? 0
        out.cacheReadTokens += row.cacheReadTokens ?? 0
        out.cacheWriteTokens += row.cacheWriteTokens ?? 0
        out.reasoningTokens += row.reasoningTokens ?? 0
        out.errors += row.errors ?? 0
        if (Number.isFinite(row.avgTtftMs) && (row.requests ?? 0) > 0) { ttftSum += row.avgTtftMs * row.requests; ttftN += row.requests }
        if (Number.isFinite(row.avgTps) && (row.requests ?? 0) > 0) { tpsSum += row.avgTps * row.requests; tpsN += row.requests }
      }
      out.avgTtftMs = ttftN > 0 ? Math.round(ttftSum / ttftN) : null
      out.avgTps = tpsN > 0 ? Math.round((tpsSum / tpsN) * 10) / 10 : null
      return out
    }

    /** Flatten the channel→provider→account tree into account rows. */
    function ledgerAccountRows(channels) {
      const rows = []
      for (const ch of channels ?? []) {
        for (const provider of ch.providers ?? []) {
          for (const account of provider.accounts ?? []) {
            rows.push({ channel: ch.channel, provider: provider.provider, accountId: account.accountId, ...mergeLedgerRows([account.totals ?? {}]), models: account.models ?? [] })
          }
        }
      }
      return rows
    }

    /** Aggregate the same tree into per-model rows (across accounts). */
    function ledgerModelRows(channels) {
      const map = new Map()
      for (const ch of channels ?? []) {
        for (const provider of ch.providers ?? []) {
          for (const account of provider.accounts ?? []) {
            for (const model of account.models ?? []) {
              const key = model.model
              const row = map.get(key) ?? { model: key, providers: new Set(), rows: [] }
              row.providers.add(provider.provider)
              row.rows.push(model)
              map.set(key, row)
            }
          }
        }
      }
      return [...map.values()].map(row => ({ model: row.model, providers: [...row.providers], ...mergeLedgerRows(row.rows) }))
    }

    /** Flatten history days into one merged tree (the 全部历史 view). */
    function mergedHistoryChannels(days) {
      const map = new Map()
      for (const day of days ?? []) {
        for (const ch of day.channels ?? []) {
          const slot = map.get(ch.channel) ?? { channel: ch.channel, providers: [] }
          for (const provider of ch.providers ?? []) {
            let pslot = slot.providers.find(row => row.provider === provider.provider)
            if (pslot === undefined) { pslot = { provider: provider.provider, accounts: [] }; slot.providers.push(pslot) }
            for (const account of provider.accounts ?? []) {
              let aslot = pslot.accounts.find(row => row.accountId === account.accountId)
              if (aslot === undefined) { aslot = { accountId: account.accountId, models: [] }; pslot.accounts.push(aslot) }
              aslot.models.push(...(account.models ?? []))
            }
          }
          map.set(ch.channel, slot)
        }
      }
      // Re-aggregate the piled-up model lists into proper totals per account.
      for (const ch of map.values()) {
        for (const provider of ch.providers) {
          for (const account of provider.accounts) {
            const byModel = new Map()
            for (const model of account.models) {
              const row = byModel.get(model.model) ?? { model: model.model, rows: [] }
              row.rows.push(model); byModel.set(model.model, row)
            }
            account.models = [...byModel.values()].map(row => ({ model: row.model, ...mergeLedgerRows(row.rows) }))
            account.totals = mergeLedgerRows(account.models)
          }
        }
      }
      return [...map.values()]
    }

    const fmtInt = value => Number.isFinite(value) ? value.toLocaleString() : '—'
    const fmtPct = (part, whole) => whole > 0 ? `${Math.round(100 * part / whole)}%` : '—'
    const fmtMs = value => Number.isFinite(value) && value > 0 ? `${value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`}` : '—'
    const fmtTps = value => Number.isFinite(value) && value > 0 ? `${value.toFixed(1)} tok/s` : '—'

    function useLedger(props) {
      const { available, rpc } = useChannelRpc(props.ctx)
      const [state, setState] = useState({ status: 'loading', history: [], snapshot: null, error: '' })
      const load = useCallback(async () => {
        if (!available) { setState(current => ({ ...current, status: 'unavailable', error: 'no-connection' })); return }
        try {
          const [ledger, history] = await Promise.all([
            rpc('usage.tokenLedger', { limit: 400 }, 60_000),
            rpc('usage.tokenLedgerHistory', { sinceDays: 90 }, 60_000),
          ])
          setState({ status: 'ready', snapshot: ledger?.snapshot ?? null, history: history?.history ?? [], totals: history?.totals ?? null, error: '' })
        } catch (error) { setState(current => ({ ...current, status: 'error', error: String(error?.message ?? error) })) }
      }, [available, rpc])
      useEffect(() => { void load() }, [load])
      return { ...state, reload: load }
    }

    /** KPI cards: one reading per card, exactly like the gateway consoles. */
    function KpiCard(props) {
      const { label, value, sub, tone } = props
      return h('div', { className: `ofm_kpi ofm_glass${tone ? ` ${tone}` : ''}` },
        h('span', { className: 'ofm_kpilabel' }, label),
        h('b', { className: 'ofm_kpivalue' }, value),
        sub === undefined ? null : h('span', { className: 'ofm_kpisub' }, sub))
    }

    function LedgerPage(props) {
      const { t, ctx } = props
      const ledger = useLedger(props)
      const [scope, setScope] = useState('today')
      const loaded = ledger.status === 'ready'
      // 今日 = the pack's live snapshot (its in-memory day tree); 全部 = the
      // persisted day aggregation, merged back into one tree. The grand
      // cumulative number always reads the history total — even on 今日 —
      // because "累计" that resets at midnight is a lie.
      const channels = scope === 'today'
        ? (ledger.snapshot?.channels ?? [])
        : mergedHistoryChannels(ledger.history)
      const totals = scope === 'today'
        ? mergeLedgerRows([ledger.snapshot?.totals ?? {}])
        : mergeLedgerRows((ledger.history ?? []).map(day => day.totals ?? {}))
      const cumulative = ledger.totals ?? ledger.snapshot?.totals ?? {}
      const accounts = ledgerAccountRows(channels)
      const models = ledgerModelRows(channels).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
      // The pack's ring is already newest-first (`token-ledger.ts`: "最近明细
      // （最新在前）", built with `unshift`), so it is used as served. Reversing it
      // here put the oldest request at the top of the table — and, behind the log
      // page's pagination, the request the user just made on the last page.
      const entries = ledger.snapshot?.entries ?? []
      const tokenTotal = totals.inputTokens + totals.outputTokens
      const cacheBase = totals.inputTokens + totals.cacheReadTokens

      if (ledger.status === 'unavailable') {
        return h('div', { className: 'ofm_page' },
          h(PageHero, { title: t('dash.title'), sub: t('dash.sub') }),
          h('div', { className: 'ofm_callout' }, h('div', null, t('chan.rpc.unavailable'))))
      }
      return h('div', { className: 'ofm_page' },
        h(PageHero, { t, titleKey: 'dash.title', subKey: 'dash.sub' },
          h('div', { className: 'ofm_seg', role: 'tablist' },
            ['today', 'all'].map(key => h('button', {
              key, type: 'button', 'aria-pressed': scope === key ? 'true' : 'false',
              onClick: () => setScope(key),
            }, key === 'today' ? t('dash.today') : t('dash.all')))),
          h(Button, { onClick: () => void ledger.reload() }, t('dash.refresh'))),
        !loaded ? h('div', { className: 'ofm_chanwrap' }, [0, 1, 2].map(i => h('div', { className: 'ofm_skel', key: i, style: { minHeight: 120 } }))) : null,
        loaded ? h('div', { className: 'ofm_kpis' },
          h(KpiCard, { label: scope === 'today' ? t('dash.kpiToday') : t('dash.kpiScopeAll'), value: fmtInt(tokenTotal), sub: `${t('dash.input')} ${fmtInt(totals.inputTokens)} · ${t('dash.output')} ${fmtInt(totals.outputTokens)} · ${t('dash.reasoning')} ${fmtInt(totals.reasoningTokens)}` }),
          h(KpiCard, { label: t('dash.kpiCumulative'), value: fmtInt((cumulative.inputTokens ?? 0) + (cumulative.outputTokens ?? 0)), sub: `${t('dash.input')} ${fmtInt(cumulative.inputTokens)} · ${t('dash.output')} ${fmtInt(cumulative.outputTokens)} · ${t('dash.reasoning')} ${fmtInt(cumulative.reasoningTokens)}` }),
          h(KpiCard, { label: t('dash.kpiSpeed'), value: fmtTps(totals.avgTps), sub: `${t('dash.ttft')} ${fmtMs(totals.avgTtftMs)}` }),
          h(KpiCard, { label: t('dash.kpiCache'), value: fmtPct(totals.cacheReadTokens, cacheBase), sub: `${t('dash.cacheTokens')} ${fmtInt(totals.cacheReadTokens)}` }),
          h(KpiCard, { label: t('dash.kpiRequests'), value: fmtInt(totals.requests), sub: `${t('dash.successRate')} ${fmtPct(totals.requests - totals.errors, totals.requests)} · ${t('dash.failed')} ${fmtInt(totals.errors)}`, tone: totals.errors > 0 ? 'warn' : '' })) : null,
        loaded ? h(Section, { title: t('dash.recentTitle'), hint: t('dash.recentHint') },
          entries.length === 0 ? h('p', { className: 'ofm_note' }, t('dash.empty'))
            : h('div', { className: 'ofm_tablewrap' }, h('table', { className: 'ofm_table' },
                h('thead', null, h('tr', null,
                h('th', { key: 'time' }, t('log.time')),
                h('th', { key: 'chan' }, t('chan.titleSingle')),
                h('th', { key: 'model' }, t('log.model')),
                h('th', { key: 'account' }, t('log.account')),
                h('th', { key: 'via' }, t('log.via')),
                h('th', { key: 'result' }, t('log.result')),
                h('th', { key: 'duration' }, t('log.duration')),
                h('th', { key: 'ttft' }, t('log.ttft')),
                h('th', { key: 'speed' }, t('log.speed')),
                h('th', { key: 'input' }, t('log.input')),
                h('th', { key: 'output' }, t('log.output')),
                h('th', { key: 'reasoning' }, t('log.reasoning')),
                h('th', { key: 'cache' }, t('log.cache')),
                h('th', { key: 'total' }, t('log.total')))),
              h('tbody', null, entries.slice(0, 12).map((entry, index) => h('tr', { key: index },
                h('td', null, new Date(entry.ts).toLocaleString()),
                h('td', null, entry.provider),
                h('td', null, entry.model),
                h('td', null, entry.accountId || '—'),
                h('td', null, entry.channel === 'gateway' ? t('log.viaGateway') : t('log.viaDirect')),
                h('td', null, entry.error ? h('span', { className: 'ofm_badge unavailable', title: entry.error }, t('log.failed')) : h('span', { className: 'ofm_badge available' }, t('log.ok'))),
                h('td', { className: 'ofm_num' }, fmtMs(entry.durationMs)),
                h('td', { className: 'ofm_num' }, fmtMs(entry.ttftMs)),
                h('td', { className: 'ofm_num' }, fmtTps(entry.tps)),
                h('td', { className: 'ofm_num' }, fmtInt(entry.inputTokens)),
                h('td', { className: 'ofm_num' }, fmtInt(entry.outputTokens)),
                h('td', { className: 'ofm_num' }, Number.isFinite(entry.reasoningTokens) ? fmtInt(entry.reasoningTokens) : '—'),
                h('td', { className: 'ofm_num' }, Number.isFinite(entry.cacheReadTokens) ? fmtInt(entry.cacheReadTokens) : '—'),
                h('td', { className: 'ofm_num' }, h('b', null, fmtInt(entry.inputTokens + entry.outputTokens))))))))) : null,
        loaded ? h(Section, { title: t('dash.accountsTitle'), hint: t('dash.accountsHint') },
          accounts.length === 0 ? h('p', { className: 'ofm_note' }, t('dash.empty'))
            : h('div', { className: 'ofm_tablewrap' }, h('table', { className: 'ofm_table' },
              h('thead', null, h('tr', null,
                h('th', { key: 'account' }, t('log.account')),
                h('th', { key: 'chan' }, t('chan.titleSingle')),
                h('th', { key: 'requests' }, t('log.requests')),
                h('th', { key: 'total' }, t('log.total')),
                h('th', { key: 'input' }, t('log.input')),
                h('th', { key: 'output' }, t('log.output')),
                h('th', { key: 'reasoning' }, t('log.reasoning')),
                h('th', { key: 'cache' }, t('log.cache')),
                h('th', { key: 'mix' }, t('log.modelMix')))),
              h('tbody', null, accounts.sort((a, b) => b.requests - a.requests).map((row, index) => h('tr', { key: index },
                h('td', null, h('b', null, row.accountId || t('log.unattributed'))),
                h('td', null, row.provider),
                h('td', { className: 'ofm_num' }, fmtInt(row.requests)),
                h('td', { className: 'ofm_num' }, fmtInt(row.inputTokens + row.outputTokens)),
                h('td', { className: 'ofm_num' }, fmtInt(row.inputTokens)),
                h('td', { className: 'ofm_num' }, fmtInt(row.outputTokens)),
                h('td', { className: 'ofm_num' }, fmtInt(row.reasoningTokens)),
                h('td', { className: 'ofm_num' }, fmtInt(row.cacheReadTokens)),
                h('td', null, (row.models ?? []).slice().sort((a, b) => ((b.inputTokens ?? 0) + (b.outputTokens ?? 0)) - ((a.inputTokens ?? 0) + (a.outputTokens ?? 0))).slice(0, 2).map(model => `${model.model} · ${fmtInt((model.inputTokens ?? 0) + (model.outputTokens ?? 0))}`).join('，') || '—'))))))) : null,
        loaded ? h(Section, { title: t('dash.modelsTitle'), hint: t('dash.modelsHint') },
          models.length === 0 ? h('p', { className: 'ofm_note' }, t('dash.empty'))
            : h('div', { className: 'ofm_tablewrap' }, h('table', { className: 'ofm_table' },
              h('thead', null, h('tr', null,
                h('th', { key: 'model' }, t('log.model')),
                h('th', { key: 'chan' }, t('chan.titleSingle')),
                h('th', { key: 'requests' }, t('log.requests')),
                h('th', { key: 'failed' }, t('log.failed')),
                h('th', { key: 'total' }, t('log.total')),
                h('th', { key: 'slash' }, t('log.inputSlash')),
                h('th', { key: 'ttft' }, t('log.ttft')),
                h('th', { key: 'speed' }, t('log.speed')),
                h('th', { key: 'hit' }, t('log.cacheHit')),
                h('th', { key: 'share' }, t('log.share')))),
              h('tbody', null, models.map(row => h('tr', { key: row.model },
                h('td', null, h('b', null, row.model)),
                h('td', null, row.providers.join('，')),
                h('td', { className: 'ofm_num' }, fmtInt(row.requests)),
                h('td', { className: 'ofm_num' }, row.errors > 0 ? h('span', { className: 'ofm_badge unavailable' }, fmtInt(row.errors)) : fmtInt(0)),
                h('td', { className: 'ofm_num' }, fmtInt(row.inputTokens + row.outputTokens)),
                h('td', { className: 'ofm_num' }, `${fmtInt(row.inputTokens)} / ${fmtInt(row.outputTokens)} / ${fmtInt(row.reasoningTokens)}`),
                h('td', { className: 'ofm_num' }, fmtMs(row.avgTtftMs)),
                h('td', { className: 'ofm_num' }, fmtTps(row.avgTps)),
                h('td', { className: 'ofm_num' }, fmtPct(row.cacheReadTokens, row.inputTokens + row.cacheReadTokens)),
                h('td', { className: 'ofm_num' }, `${fmtPct(row.inputTokens + row.outputTokens, tokenTotal)}`))))))) : null)
    }

    /** The log page: the same request ring, at full width and full detail. */
    function LogsPage(props) {
      const { t, ctx } = props
      const ledger = useLedger(props)
      const [pageSize, setPageSize] = useState(20)
      const [auto, setAuto] = useState(false)
      const reload = ledger.reload
      useEffect(() => {
        if (auto !== true) return undefined
        const timer = setInterval(() => { void reload() }, 10_000)
        return () => clearInterval(timer)
      }, [auto, reload])
      // Newest first, as the pack serves it — see the note in LedgerPage.
      const entries = ledger.snapshot?.entries ?? []
      const pages = Math.max(1, Math.ceil(entries.length / pageSize))
      const [page, setPage] = useState(1)
      const safePage = Math.min(page, pages)
      const rows = entries.slice((safePage - 1) * pageSize, safePage * pageSize)
      return h('div', { className: 'ofm_page' },
        h(PageHero, { title: t('logs.title'), sub: t('logs.sub') },
          h('div', { className: 'ofm_seg' }, [10, 20, 50, 100].map(size => h('button', {
            key: size, type: 'button', 'aria-pressed': pageSize === size ? 'true' : 'false',
            onClick: () => { setPageSize(size); setPage(1) },
          }, String(size)))),
          h(Switch, { checked: auto, label: t('logs.auto'), onChange: () => setAuto(value => !value) }),
          h(Button, { onClick: () => void reload() }, t('dash.refresh'))),
        ledger.status === 'unavailable' ? h('div', { className: 'ofm_callout' }, h('div', null, t('chan.rpc.unavailable'))) : null,
        ledger.status === 'loading' ? h('div', { className: 'ofm_skel', style: { minHeight: 200 } }) : null,
        ledger.status === 'ready' ? h(Section, {
          title: t('logs.title'),
          hint: t('logs.count').replace('{shown}', String(rows.length)).replace('{total}', String(entries.length)),
        },
          entries.length === 0 ? h('p', { className: 'ofm_note' }, t('logs.empty'))
            : h('div', { className: 'ofm_tablewrap' }, h('table', { className: 'ofm_table' },
              h('thead', null, h('tr', null,
                h('th', { key: 'time' }, t('log.time')),
                h('th', { key: 'chan' }, t('chan.titleSingle')),
                h('th', { key: 'model' }, t('log.model')),
                h('th', { key: 'account' }, t('log.account')),
                h('th', { key: 'via' }, t('log.via')),
                h('th', { key: 'result' }, t('log.result')),
                h('th', { key: 'duration' }, t('log.duration')),
                h('th', { key: 'ttft' }, t('log.ttft')),
                h('th', { key: 'speed' }, t('log.speed')),
                h('th', { key: 'input' }, t('log.input')),
                h('th', { key: 'output' }, t('log.output')),
                h('th', { key: 'reasoning' }, t('log.reasoning')),
                h('th', { key: 'cache' }, t('log.cache')),
                h('th', { key: 'total' }, t('log.total')))),
              h('tbody', null, rows.map((entry, index) => h('tr', { key: index, className: entry.error ? 'ofm_logfailed' : '' },
                h('td', null, new Date(entry.ts).toLocaleString()),
                h('td', null, entry.provider),
                h('td', null, entry.model),
                h('td', null, entry.accountId || '—'),
                h('td', null, entry.channel === 'gateway' ? t('log.viaGateway') : t('log.viaDirect')),
                h('td', null, entry.error ? h('span', { className: 'ofm_badge unavailable', title: entry.error }, t('log.failed')) : h('span', { className: 'ofm_badge available' }, t('log.ok'))),
                h('td', { className: 'ofm_num' }, fmtMs(entry.durationMs)),
                h('td', { className: 'ofm_num' }, fmtMs(entry.ttftMs)),
                h('td', { className: 'ofm_num' }, fmtTps(entry.tps)),
                h('td', { className: 'ofm_num' }, fmtInt(entry.inputTokens)),
                h('td', { className: 'ofm_num' }, fmtInt(entry.outputTokens)),
                h('td', { className: 'ofm_num' }, Number.isFinite(entry.reasoningTokens) ? fmtInt(entry.reasoningTokens) : '—'),
                h('td', { className: 'ofm_num' }, Number.isFinite(entry.cacheReadTokens) ? fmtInt(entry.cacheReadTokens) : '—'),
                h('td', { className: 'ofm_num' }, h('b', null, fmtInt(entry.inputTokens + entry.outputTokens)))))))),
          pages > 1 ? h('div', { className: 'ofm_row' },
            h(Button, { kind: 'ghost', disabled: safePage <= 1, onClick: () => setPage(value => Math.max(1, value - 1)) }, '‹'),
            h('span', { className: 'ofm_note' }, t('logs.page').replace('{page}', String(safePage)).replace('{pages}', String(pages))),
            h(Button, { kind: 'ghost', disabled: safePage >= pages, onClick: () => setPage(value => Math.min(pages, value + 1)) }, '›')) : null,
          h('p', { className: 'ofm_note' }, t('logs.windowNote'))) : null)
    }

    /** The gateway page: the pack's OpenAI endpoint plus this plugin's relay. */
    function GatewayPage(props) {
      const { t, ctx, settings, apply, busy } = props
      const { available, rpc } = useChannelRpc(ctx)
      const [status, setStatus] = useState(undefined)
      const [gwBusy, setGwBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [keyShown, setKeyShown] = useState(false)
      const [relay, setRelay] = useState(undefined)
      const [relayKey, setRelayKey] = useState('')
      const [relayBusy, setRelayBusy] = useState(false)
      const loadGateway = useCallback(async () => {
        if (!available) return
        try { setStatus(await rpc('gateway.getEnabled', {}, 30_000)) } catch (error) { setNotice(String(error?.message ?? error)) }
      }, [available, rpc])
      const loadRelay = useCallback(async () => {
        try { setRelay(await api('/chan-gateway')) } catch { setRelay(null) }
      }, [])
      useEffect(() => { void loadGateway(); void loadRelay() }, [loadGateway, loadRelay])

      const toggleGateway = async enabled => {
        setGwBusy(true); setNotice('')
        try { setStatus(await rpc('gateway.setEnabled', { enabled }, 60_000)) } catch (error) { setNotice(String(error?.message ?? error)) } finally { setGwBusy(false) }
      }
      const applyRelay = async patch => {
        setRelayBusy(true); setNotice('')
        try { setRelay(await post('/chan-gateway/apply', patch)) } catch (error) { setNotice(String(error?.message ?? error)) } finally { setRelayBusy(false) }
      }
      const showRelayKey = async () => {
        try { setRelayKey((await api('/chan-gateway/key')).key ?? '') } catch { setRelayKey('') }
      }

      // The RPC returns structured values, not strings: `address` is
      // { host, port } and `apiKey` is { value, fromEnv, path } — rendering
      // either directly hands React an object, which is a crash (#31), not a
      // wrong sentence.
      const address = status?.address ?? null
      const gatewayUrl = address !== null && typeof address === 'object'
        ? `http://${address.host}:${address.port}/v1`
        : ''
      const apiKeyInfo = typeof status?.apiKey === 'object' && status?.apiKey !== null ? status.apiKey : null
      const apiKeyValue = apiKeyInfo?.value ?? ''
      const models = status?.models ?? []
      return h('div', { className: 'ofm_page' },
        h(PageHero, { title: t('gw.title'), sub: t('gw.sub') },
          h(Button, { onClick: () => { void loadGateway(); void loadRelay() } }, t('dash.refresh'))),
        notice !== '' ? h('div', { className: 'ofm_callout ofm_error' }, h('div', null, notice)) : null,
        h(Section, { title: t('gw.gatewayTitle'), hint: t('gw.gatewayHint') },
          status === undefined ? h('div', { className: 'ofm_skel', style: { minHeight: 96 } })
            : h('div', { className: 'ofm_panel' },
              h('div', { className: 'ofm_row' },
                h(Pill, { strong: true, tone: status.running === true ? 'ok' : 'warn' }, status.running === true ? t('gw.running') : t('gw.stopped')),
                status.blockedByEnv === true ? h(Pill, { tone: 'err' }, t('gw.envBlocked')) : null,
                h(Switch, { checked: status.enabled === true, label: t('gw.switch'), onChange: () => void toggleGateway(status.enabled !== true), disabled: gwBusy })),
              h('div', { className: 'ofm_row' },
                h('span', { className: 'ofm_note' }, t('gw.endpoint')),
                gatewayUrl === '' ? h('span', { className: 'ofm_note' }, '—')
                  : h(Fragment, null, h('code', { className: 'ofm_mono' }, gatewayUrl), h(Button, { kind: 'ghost', onClick: () => copy(gatewayUrl, () => {}) }, t('eac.copy')))),
              h('div', { className: 'ofm_row' },
                h('span', { className: 'ofm_note' }, t('gw.key')),
                apiKeyValue === '' ? h('span', { className: 'ofm_note' }, t('gw.keyNone'))
                  : h(Fragment, null,
                    h('code', { className: 'ofm_mono' }, keyShown ? apiKeyValue : '••••••••••••••••'),
                    h(Button, { kind: 'ghost', onClick: () => setKeyShown(value => !value) }, keyShown ? t('gw.hide') : t('gw.show')),
                    h(Button, { kind: 'ghost', onClick: () => copy(apiKeyValue, () => {}) }, t('eac.copy'))),
                h('span', { className: 'ofm_note' }, apiKeyInfo === null ? t('gw.keyNoneHint') : t('gw.keyNote'))),
              h('div', { className: 'ofm_row' },
                h('span', { className: 'ofm_note' }, `${t('gw.models')} ${models.length}`),
                h('span', { className: 'ofm_note' }, t('gw.portNote'))))),
        h(Section, { title: t('gw.relayTitle'), hint: t('gw.relayHint') },
          relay === undefined ? h('div', { className: 'ofm_skel', style: { minHeight: 96 } })
            : h('div', { className: 'ofm_panel' },
              h('div', { className: 'ofm_row' },
                h(Pill, { strong: true, tone: relay.relay?.running === true ? 'ok' : 'warn' }, relay.relay?.running === true ? t('gw.running') : t('gw.stopped')),
                h(Switch, {
                  checked: relay.relay?.enabled === true, label: t('gw.relaySwitch'), disabled: relayBusy,
                  onChange: () => void applyRelay({ enabled: relay.relay?.enabled !== true }),
                })),
              relay.relay?.error ? h('div', { className: 'ofm_callout ofm_error' }, h('div', null, relay.relay.error)) : null,
              h('div', { className: 'ofm_row' },
                h('div', { className: 'ofm_field' }, h('span', null, t('gw.relayBind')),
                  h('select', {
                    className: 'ofm_input', value: relay.relay?.host ?? '127.0.0.1',
                    onChange: event => void applyRelay({ host: event.target.value }),
                  },
                  h('option', { value: '127.0.0.1' }, t('gw.bindLocal')),
                  h('option', { value: '0.0.0.0' }, t('gw.bindLan')))),
                h('div', { className: 'ofm_field' }, h('span', null, t('gw.relayPort')),
                  h('input', {
                    className: 'ofm_input', type: 'number', min: 0, max: 65535, style: { width: 120 },
                    defaultValue: relay.relay?.port ?? 18326,
                    onBlur: event => { const port = Number(event.target.value); if (Number.isInteger(port) && port >= 0 && port <= 65535 && port !== (relay.relay?.port ?? 0)) void applyRelay({ port }) },
                  }))),
              relay.relay?.running === true ? h('div', { className: 'ofm_row' },
                h('span', { className: 'ofm_note' }, t('gw.relayUrl')),
                h('code', { className: 'ofm_mono' }, `http://${relay.relay.host === '0.0.0.0' || relay.relay.host === '::' ? '<lan-ip>' : relay.relay.host}:${relay.relay.port}/v1`),
                h(Button, { kind: 'ghost', onClick: () => copy(`http://${relay.relay.host}:${relay.relay.port}/v1`, () => {}) }, t('eac.copy'))) : null,
              h('div', { className: 'ofm_row' },
                h('span', { className: 'ofm_note' }, t('gw.relayKey')),
                h('code', { className: 'ofm_mono' }, relayKey === '' ? '••••••••••••••••' : relayKey),
                h(Button, { kind: 'ghost', onClick: () => void showRelayKey() }, t('gw.show')),
                relayKey === '' ? null : h(Button, { kind: 'ghost', onClick: () => copy(relayKey, () => {}) }, t('eac.copy')),
                h(Button, {
                  kind: 'ghost', disabled: relayBusy,
                  onClick: async () => { try { setRelayKey((await post('/chan-gateway/rotate')).key ?? '') } catch (error) { setNotice(String(error?.message ?? error)) } },
                }, t('gw.rotate'))),
              h('p', { className: 'ofm_note' }, t('gw.relayNote')))),
        h(Section, { title: t('section.egress'), hint: t('section.egressHint') }, h(Egress, { settings, t, onApply: apply, busy })))
    }

    /** Shared page hero for the three gateway-console pages. The caller
     *  renders the copy: literal t() calls stay visible to the copy lint. */
    function PageHero(props) {
      const { title, sub, children } = props
      return h('header', { className: 'ofm_hero ofm_glass' },
        h('div', { className: 'ofm_pagehead' },
          h('div', { className: 'ofm_pagetitle' },
            h('h2', null, title),
            h('p', { className: 'ofm_pagesub' }, sub)),
          children))
    }

    // ── settings page ─────────────────────────────────────────────────────────
    function SettingsPage(props) {
      const tagged = props.locale === undefined ? props.t : Object.assign(x => props.t(x), { locale: props.locale })
      const t = tagged
      const [busy, setBusy] = useState(false)
      const summary = useAsync(() => api('/summary'), [])

      const apply = async patch => {
        setBusy(true)
        try {
          await post('/settings', patch)
          summary.reload()
        } catch (error) {
          // The route can refuse a patch — a routable forward bind, for one — and a
          // rejection nobody shows is a button that appears to do nothing.
          showToast({ title: t('settings.failed'), body: String(error?.message ?? error), tone: 'warn' })
        } finally { setBusy(false) }
      }

      if (summary.status === 'loading' && summary.data === undefined) return h('div', { className: 'ofm_root' }, h('p', { className: 'ofm_note' }, t('loading')))
      if (summary.status === 'error') {
        return h('div', { className: 'ofm_root' },
          h('div', { className: 'ofm_callout ofm_error' }, h('div', null, h('b', null, t('loadFailed')), h('div', null, summary.error))),
          h('div', null, h(Button, { onClick: () => summary.reload() }, t('retry'))))
      }
      return h(Shell, { t: tagged, data: summary.data, summary, busy, apply, ctx: props.ctx })
    }

    // ── the four-page shell ───────────────────────────────────────────────────
    // The settings section is four pages behind one glass navigation bar: the
    // channel logins, the token ledger, the request log and the gateway. The
    // active page lives in localStorage so a reload comes back to the page the
    // user was reading.
    const TAB_KEY = 'ofm.tab'
    const TABS = ['channels', 'ledger', 'logs', 'gateway']

    function Shell(props) {
      const { t, data, summary, busy, apply, ctx } = props
      const [tab, setTab] = useState(() => {
        try {
          const saved = window.localStorage?.getItem(TAB_KEY)
          return TABS.includes(saved) ? saved : 'channels'
        } catch { return 'channels' }
      })
      const tabRefs = useRef({})
      const [glider, setGlider] = useState({ left: 0, top: 0, width: 0, height: 0 })
      useEffect(() => {
        try { window.localStorage?.setItem(TAB_KEY, tab) } catch { /* storage unavailable */ }
        const node = tabRefs.current[tab]
        // Tabs may wrap onto a second row inside the group, so the glider is
        // placed on both axes: translate alone would put it at the right
        // height and the wrong row.
        if (node !== undefined && node !== null) setGlider({ left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight })
      }, [tab, t.locale])

      const tabs = [
        ['channels', t('nav.tab.channels'), CHANNEL_PROVIDERS.length],
        ['ledger', t('nav.tab.ledger'), null],
        ['logs', t('nav.tab.logs'), null],
        ['gateway', t('nav.tab.gateway'), null],
      ]
      const nav = h('nav', { className: 'ofm_nav' },
        h('span', { className: 'ofm_navbrand' },
          h('span', { className: 'ofm_navmark', 'aria-hidden': 'true' },
            h('img', { src: BRAND_ICON, alt: '' })),
          t('title')),
        h('div', { className: 'ofm_tabs', role: 'tablist' },
          h('span', { className: 'ofm_tabglider', style: { transform: `translate(${glider.left}px, ${glider.top}px)`, width: `${glider.width}px`, height: `${glider.height}px` } }),
          tabs.map(([id, label, num]) => h('button', {
            key: id, type: 'button', role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', className: 'ofm_tab', 'data-on': tab === id ? 'true' : 'false',
            ref: node => { tabRefs.current[id] = node },
            onClick: () => setTab(id),
          }, label, num === null ? null : h('span', { className: 'ofm_tabnum' }, String(num))))),
        h('span', { className: 'ofm_navspacer' }))

      const page = tab === 'ledger'
        ? h(LedgerPage, { t, ctx })
        : tab === 'logs'
          ? h(LogsPage, { t, ctx })
          : tab === 'gateway'
            ? h(GatewayPage, { t, ctx, settings: data.settings, apply, busy })
            : h(ChannelsPage, { t, ctx, summary: data })

      return h('div', { className: 'ofm_root ofm_shell' }, nav, page)
    }

    // ── registration ──────────────────────────────────────────────────────────
    // The shell mirrors the active language onto <html lang>, so a render-time
    // read survives a language switch without owning a subscription.
    function localeTag(ctx) {
      try {
        const snapshot = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : ctx.locale?.getSnapshot?.()
        const value = snapshot?.active ?? ctx.locale?.locale
        return typeof value === 'string' ? value : document.documentElement.lang || 'en'
      } catch { return 'en' }
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'our-free-model: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-free-model')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'our-free-model: styles')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'our-free-model',
        order: 35,
        label: () => t('nav'),
        locale: NS,
      }, props => h(SettingsPage, { ...props, locale: localeTag(ctx), ctx })))
    }
    exports.apply = apply
    exports.inject = inject
    exports.name = 'our-free-model'
    // Headless test seams use the same stub React as scripts/client-lint.mjs.
    exports.__test = { parseSafeHtml, safeUrl, sanitizeStyle, htmlToDom, ChannelsPage, groupChannelsByConnected, CHANNEL_PROVIDERS }
    return module.exports
  },
})
