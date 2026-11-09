/**
 * Run every offline suite in one command.
 *
 *     node scripts/test-all.mjs [--only <name>]
 *
 * These are the checks that need no network and spend no account quota: each one
 * mounts the real module against a local stand-in. The live end-to-end run — a
 * real profile, a real channel login — is a deliberate act and is not here.
 *
 * Upstream ran 45 suites over the free lane, the co-paid lane, the aggregate
 * lane, the token savers and the standalone product. This fork keeps the ones
 * that still have a subject: the browser half's registration/copy/style
 * contracts, the host's whole HTTP surface, the request fence, the egress
 * outlet, the gateway relay, and the absorbed channel pack itself.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const options = { only: null }
for (let index = 2; index < process.argv.length; index += 1) {
  const flag = process.argv[index]
  if (flag !== '--only' || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    console.error(`usage: node scripts/test-all.mjs [--only <name>] (invalid ${flag})`)
    process.exit(1)
  }
  options[flag.slice(2)] = process.argv[++index]
}
const { only } = options

const suites = [
  // The browser half: it registers, every copy key exists in both languages, and
  // every style rule it declares is reachable from the code.
  ['client-lint', 'client-lint.mjs', []],
  // ...and it actually renders: the four pages against host-shaped payloads, so a
  // page that still referenced a deleted component cannot pass.
  ['client-render', 'client-render-test.mjs', []],
  // The host half: the whole /api/our-free-model surface, mounted offline, plus
  // the routes the removed features must no longer answer.
  ['host-smoke', 'host-smoke-test.mjs', []],
  // The host modules that carry their own contracts.
  ['trust', 'trust-test.mjs', []],
  ['chan-relay', 'chan-relay-test.mjs', []],
  ['egress', 'egress-test.mjs', []],
  // The absorbed pack: mount, provider set, credits, image pricing, proxy rules.
  ['channel-pack', 'channel-pack-test.mjs', []],
  // ...and the metadata it feeds the picker: effort tables, context windows, and
  // the declared effort order. These are silent-mismatch defects — a wrong value
  // shows up as a missing effort or a mysteriously truncated long session, never
  // as an error pointing at the declaration.
  ['channel-model-metadata', 'channel-model-metadata-test.mjs', []],
  // ...and the catalog plumbing: broadcast on landing, "complete" vs "got", and
  // the bounded cold-start prewarm. All three fail silently — the user sees
  // "fewer models" or "only fixed by a restart", never an error.
  ['channel-catalog', 'channel-catalog-test.mjs', ['--experimental-strip-types']],
  // ...and, behaviourally: a partial catalog must heal on the next read. This is
  // the layer that catches "complete was passed correctly but the short-circuit
  // still swallowed the retry" — the defect the unit-level checks cannot see.
  ['channel-catalog-heal', 'channel-catalog-heal-test.mjs', []],
  // ...and the gateway's own contract fixes: the source kind must match dsh-llm's
  // module-augmented vocabulary, and the Cline models.dev loader must be a
  // conditional request with a 304 fallback (never a silent empty catalog).
  ['channel-gateway-source', 'channel-gateway-source-test.mjs', []],
  ['channel-cline-dev', 'channel-cline-dev-test.mjs', ['--experimental-strip-types']],
  // The ported OfficeAce channel: its "lock permanent credits" switch must have a
  // real execution path (upstream IKLTHB shipped it as a silent no-op switch).
  ['channel-officeace-lock', 'channel-officeace-lock-test.mjs', ['--experimental-strip-types']],
  ['channel-officeace-login', 'channel-officeace-login-test.mjs', []],
  ['channel-accio', 'channel-accio-test.mjs', ['--experimental-strip-types']],
  // WorkBuddy/CodeBuddy：`X-Conversation-*` 三头（缺则特定账号整条渠道 400/11128 全灭）
  // 与渠道校验档（换号、不写冷却、PERMISSION_DENIED 指向账号）。
  ['channel-buddy-conv', 'channel-buddy-conv-test.mjs', []],
  // 腾讯系内容指纹改写：assistant 正文那格一旦漏改，带毒历史每轮重放 ⇒ 会话报废。
  ['channel-fingerprint', 'channel-fingerprint-test.mjs', []],
  // 额度耗尽（14018）与频率限流共用 429 但冷却终点相反；两条腿（推理/探测）必须同形。
  ['channel-credit-exhausted', 'channel-credit-exhausted-test.mjs', []],
  // 工具参数三分类：掐断(truncated) vs 写坏(invalid) 处置相反；坏参数不可重试。
  ['channel-tool-args', 'channel-tool-args-test.mjs', []],
  // 续期成功但落盘失败 = 终态；各家必须注入**自己那家**的错误类（跨模块 instanceof 恒 false）。
  ['channel-expiry-terminal', 'channel-expiry-terminal-test.mjs', []],
  // 模型上下架自适应：10 家 refreshCatalog + 30 分钟定时器保鲜 + 失败保留旧目录。
  ['channel-catalog-refresh', 'channel-catalog-refresh-test.mjs', []],
  // Accio 请求级账号轮换：402/429 换号+冷却、401 换号不冷却、400 不换号。
  ['channel-accio-rotate', 'channel-accio-rotate-test.mjs', []],
  // TRAE 多 tool_call 时工具结果图片必须排在全部 tool 之后（否则 4027 会话永久损坏）。
  ['channel-trae-image-order', 'channel-trae-image-order-test.mjs', []],
  // ZCode：system 数组恒 3 块（第 4 块 ⇒ 405+3012），调用方 system 走 messages。
  ['channel-zcode-system-blocks', 'channel-zcode-system-blocks-test.mjs', []],
  // ZCode 405 恒不可重试（归 SERVER 会让 harness 白重试 5 轮并累积账号冷却惩罚）。
  ['channel-zcode-405', 'channel-zcode-405-test.mjs', []],
  // OfficeAce 每日签到：失败必须留痕 + 撤销占坑（否则本小时钉死、当天 1000 分白丢）。
  ['channel-officeace-checkin', 'channel-officeace-checkin-test.mjs', []],
  // CodeArts：UA 覆盖（WAF 按 deepseek-harness/ 前缀拒发）+ 三业务码单列。
  ['channel-codearts-ua-codes', 'channel-codearts-ua-codes-test.mjs', []],
  ['channel-network', 'channel-network-test.mjs', []],
].filter(([name]) => only === null || name.startsWith(only))

if (only !== null && suites.length === 0) {
  console.error(`--only "${only}" selected no suite`)
  process.exit(1)
}

/**
 * A suite that hangs must leave enough output to identify where it stopped.
 *
 * One of upstream's suites bound a fixed port, lost the race to a suite running
 * beside it, and then sat in a `fetch` whose socket nobody answered — three
 * minutes of the runner's own ceiling, after which it printed six `ok` lines as
 * the "failure detail" because buffered child output was unavailable. The
 * deadline is well above the slowest suite, and live output now identifies the
 * last check seen.
 */
const SUITE_TIMEOUT_MS = 60_000

/**
 * Run a suite while forwarding its output as it arrives. Keeping the output
 * live is important here: a timeout kills the child before a buffered pipe can
 * be read, which erases the last check the suite printed.
 */
function runSuite(script, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(scriptsDir, script), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let forceKillTimer
    let spawnError = null
    const started = Date.now()
    const forward = (stream, chunk) => {
      const text = chunk.toString()
      stream === 'stdout' ? stdout += text : stderr += text
      process[stream].write(text)
    }
    child.stdout.on('data', chunk => forward('stdout', chunk))
    child.stderr.on('data', chunk => forward('stderr', chunk))
    const deadline = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      timedOut = true
      child.kill()
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 500)
    }, SUITE_TIMEOUT_MS)
    child.once('error', error => {
      spawnError = error
    })
    child.once('close', (status, signal) => {
      clearTimeout(deadline)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      resolve({ error: spawnError, signal, status, stdout, stderr, ms: Date.now() - started, timedOut })
    })
  })
}

const results = []
console.log('test mode: offline suites only')
for (const [name, script, args] of suites) {
  const run = await runSuite(script, args)
  const output = `${run.stdout}${run.stderr}`.trimEnd().split('\n')
  const hung = run.timedOut || run.error !== null || run.signal !== null
  const ok = !hung && run.status === 0
  results.push({ name, ok, ms: run.ms, output })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(14)} ${String(run.ms).padStart(5)} ms`)
  if (!ok) {
    if (run.timedOut) console.log(`       killed at the ${SUITE_TIMEOUT_MS / 1000}s deadline — the live output above is the last diagnostic from the suite`)
    else if (hung) console.log(`       never finished (${run.error?.message ?? `signal ${run.signal}`})`)
    const detail = output.filter(line => /^(FAIL|✗|Error|error:)/.test(line.trim())).slice(0, 6)
    for (const line of (detail.length > 0 ? detail : output.slice(-12))) console.log(`       ${line}`)
  }
}

const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} suites passed${failed.length > 0 ? ` — ${failed.map(f => f.name).join(', ')} failed` : ''}`)
process.exitCode = failed.length === 0 ? 0 : 1
