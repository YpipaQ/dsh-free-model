/**
 * Our Free Model — plugin entry (Host half), channels-only fork.
 *
 * Upstream 2.1.0 shipped nine settings pages behind one host: an anonymous free
 * lane (opencode.ai), a Kilo free pool, the GitHub-gated EAC co-paid lane, a
 * 76-provider aggregate lane with bring-your-own keys, named fallback chains
 * (combos), a token-saving pipeline that runs inside that one adapter, a
 * first-run announcement feed, a remote-published self-updater and a hot reload.
 *
 * This fork keeps exactly one of them: the absorbed channel pack
 * (`vendor/channel-pack`), which carries the fourteen 白嫖 account providers
 * (CodeArts, CodeBuddy / WorkBuddy, LobsterAI, Qoder / Qoder CN, TRAE, Cline,
 * Loomy, Raccoon, MiniMax Code, ZCode, Gemini) and their OpenAI-compatible
 * loopback gateway. Everything that hung off the plugin's own model adapter is
 * gone, together with its routes, stores, timers and files.
 *
 * What this half still owns:
 *   - the settings file (`egress`, `chanGateway.relay`);
 *   - the egress outlet the pack sends its traffic through;
 *   - the pack's gateway relay — this plugin's own key, LAN-optional;
 *   - the JSON API the four remaining settings pages read
 *     (白嫖模型接入 / 数据看板 / 运行日志 / 网关设置).
 *
 * The dashboard and the request log do not come from here: the pack keeps its
 * own per-request token ledger and serves it over the shell's `connection` RPC,
 * so nothing in this half has to measure a turn.
 *
 * `llm` stays the only declared dependency. The pack mounts onto
 * `credentials`/`commands`/`llm` in a nested fiber of its own, so a composition
 * without a web server still serves models, and a composition that omits the
 * pack's services degrades to "no channels" instead of failing the plugin.
 *
 * @module index.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR_NAME, JsonStore, SETTINGS_INITIAL, resolveDshHome } from './src/store.js'
import { generateKey } from './src/key.js'
import { chanGatewayCredential, chanGatewayEnabled, chanGatewayPort, startChanRelay } from './src/chan-relay.js'
import { egressActive, egressFetch, outletLabel, readOutletSelection, startEgressRelay } from './src/egress.js'
import { connectionAdmissionView, rejectionFor } from './src/trust.js'

export const name = 'our-free-model'

/** The installed package directory, read once so `/summary` can name it. */
const PKG_DIR = fileURLToPath(new URL('./', import.meta.url))

/** Published version of the installed package, read once at load. */
function readPackageVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version ?? '')
  } catch {
    return ''
  }
}

export const version = readPackageVersion()

/**
 * `llm` is what the plugin exists for, so it is the only hard requirement of the
 * plugin itself.
 *
 * Cordis withholds from a context any service its fiber does not name in
 * `inject`, and keeps that fiber PENDING while a named one is absent — which is
 * how v1.2.1 stayed permanently inactive on a composition with no HTTP server
 * (upstream issue #4). So nothing else may be named here: a headless
 * composition would rather serve channels without a settings page than serve
 * nothing.
 *
 * What that costs and what still works:
 * - `webServer` — the four in-app pages. Reached through a nested `ctx.inject`
 *   fiber (see the browser-facing API section), which pends on its own and
 *   never blocks the pack above.
 * - `timer` (`ctx.interval`) — nothing. The one background loop below is a
 *   plain unref'd timer, because reading a mixin off an undeclared service
 *   throws rather than answering `undefined`.
 * - `connection` — the fence falls back to its structural replica.
 */
export const inject = ['llm']

export function apply(ctx) {
  const logger = ctx.logger ?? console
  const dataDir = path.resolve(resolveDshHome(), DATA_DIR_NAME)
  fs.mkdirSync(dataDir, { recursive: true })

  /**
   * The only durable state this fork keeps.
   *
   * Upstream's `stats.json`, `availability.json` and `catalog.json` are gone
   * with the lane that filled them; a `settings.json` written by 2.1.0 still
   * carries those keys, and `JsonStore.load` merges the file over the defaults,
   * so they survive as inert extras rather than being rewritten under the user.
   */
  const settings = new JsonStore(path.join(dataDir, 'settings.json'), structuredClone(SETTINGS_INITIAL), {
    log: message => logger.warn?.(message),
  })

  /**
   * Read a service the composition may or may not mount.
   *
   * `ctx.get` is cordis' opportunistic lookup: it answers `undefined` instead of
   * throwing when the service is absent — and also while it is merely not
   * provided yet, which matters because plugins load before the browser half has
   * published anything. So a service read this way is a snapshot: `connection`
   * is therefore resolved per request (see `fenceConnection` below).
   */
  const optional = service => (typeof ctx.get === 'function' ? ctx.get(service) : undefined)
  /**
   * The trust fence's view of the connection service, looked up per request.
   *
   * The browser half publishes `connection` after plugins have loaded, so reading
   * it once here would freeze in "absent" and leave every request on the replica
   * fence for the life of the process. The view takes the service *thunk* rather
   * than the service, and its `admit` answers `undefined` — not a no-op function
   * — while the service is missing, which is what makes the fence fall through to
   * its own structural check instead of reading as "admitted".
   *
   * #871: on hosts since dsh 0.2.2-rc.2 — including the dsh 0.2.3-alpha.2 this
   * was reproduced on — `connection.admit` internally reads `this.authentication`,
   * and strict Cordis property validation throws `cannot get property
   * "connection.authentication" without inject` for a fiber that never named it.
   * `rejectionFor` catches that throw and answers the uniform 503 `admission
   * unavailable`, which the pages render as 「无法连接插件后端」. So the service is
   * resolved from a nested fiber that declares BOTH keys — the fix upstream
   * shipped in 2.9.0, and the house pattern used here for
   * `credentials`/`commands`/`llm` and `webServer`: that fiber pends on its own
   * and never holds up the root fiber. Until it runs, or on a host that mounts
   * nothing, the opportunistic `ctx.get` snapshot applies exactly as before.
   */
  let fenceScoped = null
  ctx.inject(['connection', 'connection.authentication'], scoped => {
    fenceScoped = scoped
  })
  const fenceService = () => {
    if (fenceScoped) {
      try {
        const declared = fenceScoped['connection']
        if (declared) return declared
      } catch {
        // Older hosts without declared-scope reads: fall through.
      }
      try {
        const looked = typeof fenceScoped.get === 'function'
          ? fenceScoped.get('connection')
          : undefined
        if (looked) return looked
      } catch {
        // Same: the opportunistic snapshot below is the last resort.
      }
    }
    return optional('connection')
  }
  const fenceConnection = connectionAdmissionView(fenceService)

  /** Set when this generation is disposed; late async callbacks must stand down. */
  let disposed = false
  /** The optional egress outlet (subscription or single client), off by default. */
  let outletRelay = null
  let outletError = ''
  /** Last reading of the outlet's own view of itself, cached for `/summary`. */
  let outletNode = { node: '', delayMs: 0, at: 0 }

  // ── the absorbed channel pack ───────────────────────────────────────────────
  /**
   * The 白嫖 channels — CodeArts (华为云), CodeBuddy / WorkBuddy (腾讯), LobsterAI
   * (有道), Qoder / Qoder CN (阿里系), TRAE (字节), Cline, Loomy (讯飞), Raccoon
   * (商汤), MiniMax Code, ZCode (智谱) and Gemini (Google) — are carried with
   * local integration adaptations from the plugin that shipped them, vendored
   * under `vendor/channel-pack` (provenance in `vendor/channel-pack/NOTICE.md`).
   * Mounting the pack keeps every login flow, account pool, credit claim, model
   * blacklist and its local OpenAI gateway working as validated upstream,
   * instead of being re-implemented here and drifting.
   *
   * The pack runs on a fiber of its own, after `credentials`, `commands` and
   * `llm` exist. `channelPack` is the state bit `/summary` reports so the page
   * can say *why* the channel list is empty instead of showing nothing.
   */
  let channelPack = { state: 'pending', error: '' }
  ctx.inject(['credentials', 'commands', 'llm'], scoped => {
    let stopped = false
    scoped.effect(() => () => { stopped = true }, 'our-free-model: channel pack')
    // Dynamic import: the pack's own imports (the kernel's llm and credential
    // modules) are host-provided, and a composition that lacks them must still
    // load this plugin. `pack.js` is the bundled form of the vendored tree (see
    // scripts/build-channel-pack.mjs) — one file, so the release artifact stays
    // inside its file cap.
    void import('./vendor/channel-pack/pack.js').then(pack => {
      if (stopped) return
      pack.apply(scoped, {
        // The anonymous OpenCode lane belonged to upstream's free lane, which
        // this fork removed: the pack must not quietly re-introduce it.
        disableOpencode: true,
        outlet: { active: egressActive, fetch: egressFetch },
      })
      channelPack = { state: 'ready', error: '' }
      logger.info?.('our-free-model: channel pack mounted (CodeArts, CodeBuddy, and 11 more)')
    }).catch(error => {
      if (stopped) return
      channelPack = { state: 'failed', error: String(error?.message ?? error).slice(0, 300) }
      logger.warn?.(`our-free-model: channel pack unavailable (${channelPack.error})`)
    })
  })

  // ── the channels' gateway relay ─────────────────────────────────────────────
  /**
   * The absorbed pack serves every 白嫖 provider through one OpenAI-compatible
   * gateway on the loopback. The relay is this plugin's own door in front of
   * it: callers authenticate with `chanGateway.relay.key` and the forwarded
   * hop is re-stamped with the gateway's own credential, which never leaves
   * the host. Off until asked for; the settings page owns the switch.
   */
  let chanRelay = null
  let chanRelayError = ''
  let chanRelaySyncInFlight = null

  function chanRelayKey() {
    const relay = settings.get().chanGateway?.relay ?? {}
    if (typeof relay.key === 'string' && relay.key !== '') return relay.key
    const minted = generateKey()
    settings.update({ chanGateway: { ...(settings.get().chanGateway ?? {}), relay: { ...(settings.get().chanGateway?.relay ?? {}), key: minted } } })
    settings.flush()
    return minted
  }

  function rotateChanRelayKey() {
    const minted = generateKey()
    settings.update({ chanGateway: { ...(settings.get().chanGateway ?? {}), relay: { ...(settings.get().chanGateway?.relay ?? {}), key: minted } } })
    settings.flush()
    return minted
  }

  /** The gateway's address and credential, read fresh: both can move (env). */
  function chanGatewayTarget() {
    return {
      port: chanGatewayPort(process.env),
      enabledByEnv: chanGatewayEnabled(process.env),
      credential: chanGatewayCredential({ profileContext: optional('profileContext'), env: process.env }),
    }
  }

  async function syncChanRelay() {
    while (chanRelaySyncInFlight !== null) await chanRelaySyncInFlight.catch(() => {})
    const run = syncChanRelayOnce()
    chanRelaySyncInFlight = run
    try { await run } finally { if (chanRelaySyncInFlight === run) chanRelaySyncInFlight = null }
  }
  async function syncChanRelayOnce() {
    const relay = settings.get().chanGateway?.relay ?? {}
    const wanted = relay.enabled === true
    const host = String(relay.host ?? '').trim() || '127.0.0.1'
    const port = Number.isFinite(Number(relay.port)) && Number(relay.port) > 0 ? Math.trunc(Number(relay.port)) : 0
    const target = chanGatewayTarget()
    if (chanRelay !== null && wanted && chanRelay.host === host && chanRelay.port === port) return
    if (chanRelay === null && !wanted) return
    if (chanRelay !== null) {
      const closing = chanRelay
      chanRelay = null
      await closing.close().catch(() => {})
    }
    if (!wanted) { chanRelayError = ''; return }
    if (port !== 0 && target.port === port) {
      chanRelayError = 'the relay needs a port of its own (the gateway listens on ' + target.port + ')'
      logger.warn?.(`our-free-model: channel gateway relay not started (${chanRelayError})`)
      return
    }
    try {
      chanRelay = await startChanRelay({
        config: () => {
          const current = settings.get().chanGateway?.relay ?? {}
          const targetNow = chanGatewayTarget()
          return {
            enabled: current.enabled === true,
            host: String(current.host ?? '').trim() || '127.0.0.1',
            port: current.port ?? 0,
            lanKey: chanRelayKey(),
            gatewayHost: '127.0.0.1',
            gatewayPort: targetNow.port,
            gatewayKey: targetNow.credential?.key ?? '',
          }
        },
        log: message => logger.warn?.(`our-free-model channel relay: ${message}`),
      })
      chanRelayError = ''
      // The bound port goes back into the settings, so the page shows the
      // address that actually answers (the OS picks when 0 was asked for).
      const settled = settings.get().chanGateway ?? {}
      settings.update({ chanGateway: { ...settled, relay: { ...(settled.relay ?? {}), port: chanRelay.port } } })
      settings.flush()
    } catch (error) {
      chanRelayError = String(error?.message ?? error)
      logger.warn?.(`our-free-model: channel gateway relay could not start (${chanRelayError})`)
    }
  }

  function chanRelayStatus() {
    const relay = settings.get().chanGateway?.relay ?? {}
    const target = chanGatewayTarget()
    return {
      relay: {
        enabled: relay.enabled === true,
        running: chanRelay !== null,
        host: chanRelay?.host ?? (String(relay.host ?? '').trim() || '127.0.0.1'),
        port: chanRelay?.port ?? relay.port ?? 0,
        hasKey: typeof relay.key === 'string' && relay.key !== '',
        error: chanRelayError,
      },
      gateway: {
        port: target.port,
        enabledByEnv: target.enabledByEnv,
        keyFound: target.credential !== null,
        keyFromEnv: target.credential?.fromEnv === true,
        keyPath: target.credential?.path ?? '',
      },
    }
  }


  // ── egress outlet ───────────────────────────────────────────────────────────

  /**
   * Which node the outlet is carrying traffic on. Purely informational: every
   * failure is a missing reading, never an error, because the outlet itself may
   * be perfectly healthy while the controller call that describes it is not.
   */
  async function readOutletStatus() {
    const relay = outletRelay
    if (relay === null) {
      outletNode = { node: '', delayMs: 0, at: 0 }
      return { node: '', nodeDelayMs: 0, nodeAt: 0 }
    }
    const selection = await readOutletSelection(relay).catch(() => null)
    // A settled read is cached for `/summary`, which cannot await a round trip.
    if (outletRelay === relay) {
      outletNode = { node: selection?.node ?? '', delayMs: selection?.delayMs ?? 0, at: Date.now() }
    }
    return {
      node: selection?.node ?? '',
      nodeDelayMs: selection?.delayMs ?? 0,
      nodeAt: Date.now(),
    }
  }
  // Same serialisation gate as the two listeners above: the boot chain and every
  // settings POST call this, and overlapping runs would leak a spawned mihomo
  // (the loser overwrites `outletRelay` while the winner's child still runs).
  let outletSyncInFlight = null
  /** What the currently running outlet was started with — restart on change. */
  let outletFingerprint = ''
  async function syncEgress() {
    while (outletSyncInFlight !== null) await outletSyncInFlight.catch(() => {})
    const run = syncEgressOnce()
    outletSyncInFlight = run
    try { await run } finally { if (outletSyncInFlight === run) outletSyncInFlight = null }
  }
  async function syncEgressOnce() {
    const desired = settings.get().egress ?? {}
    const wanted = desired.enabled === true
    const mode = desired.mode === 'client' ? 'client' : 'subscription'
    const url = String(desired.url ?? '').trim()
    const mihomoPath = String(desired.mihomoPath ?? '').trim()
    const fingerprint = `${mode}\n${url}\n${mihomoPath}`
    if (outletRelay !== null && wanted && outletFingerprint === fingerprint && !outletRelay.dead) return
    if (outletRelay === null && !wanted) return
    if (outletRelay !== null) {
      const closing = outletRelay
      outletRelay = null
      outletFingerprint = ''
      await closing.close().catch(() => {})
    }
    if (!wanted) {
      outletError = ''
      return
    }
    if (url === '') {
      outletError = 'the outlet needs a subscription or proxy URL'
      logger.warn?.(`our-free-model: egress outlet not started (${outletError})`)
      return
    }
    try {
      outletRelay = await startEgressRelay({
        config: () => {
          const current = settings.get().egress ?? {}
          return {
            mode: current.mode === 'client' ? 'client' : 'subscription',
            url: String(current.url ?? '').trim(),
            mihomoPath: String(current.mihomoPath ?? '').trim(),
          }
        },
        dataDir,
        log: message => logger.info?.(`our-free-model egress: ${message}`),
        onDead: scheduleOutletRestart,
      })
      outletFingerprint = fingerprint
      outletError = ''
      outletUpSince = Date.now()
      logger.info?.(`our-free-model: egress outlet up (${outletLabel(url)} via ${mode})`)
    } catch (error) {
      outletError = String(error?.message ?? error)
      logger.warn?.(`our-free-model: egress outlet could not start (${outletError})`)
    }
  }

  // A managed mihomo that dies mid-run used to leave the outlet bricked until
  // the user touched the settings page: the relay stays up but its dial port is
  // gone, so every upstream turn fails. syncEgressOnce already restarts a dead
  // relay with an unchanged fingerprint — this only calls it, with a backoff so
  // a mihomo that dies at boot cannot spin into a start/exit loop. A run that
  // lasted two minutes counts as healthy and resets the ladder.
  const OUTLET_STABLE_MS = 120_000
  let outletUpSince = 0
  let outletRestartAttempts = 0
  let outletRestartTimer = null
  function scheduleOutletRestart() {
    if (outletRestartTimer !== null) return
    if (Date.now() - outletUpSince >= OUTLET_STABLE_MS) outletRestartAttempts = 0
    const delay = Math.min(15_000 * 2 ** outletRestartAttempts, 600_000)
    outletRestartAttempts += 1
    logger.warn?.(`our-free-model: egress outlet went down; restarting in ${Math.round(delay / 1000)}s (attempt ${outletRestartAttempts})`)
    outletRestartTimer = setTimeout(() => {
      outletRestartTimer = null
      void syncEgress().catch(() => {})
    }, delay)
    outletRestartTimer.unref?.()
  }

  // ── browser-facing API ──────────────────────────────────────────────────────
  const logAdmissionRejection = surface => ({ status, source, reason }) => {
    // Fixed fields only: headers, request URLs and admission errors may contain
    // credentials. Every surface reports the same admission boundary.
    logger.warn?.(`our-free-model: ${surface} admission rejected status=${status} source=${source} reason=${reason}`)
  }
  const api = createApiRoutes({
    settings,
    version,
    // The absorbed channel pack's liveness, for the 白嫖接入 page: the page
    // renders its channel grid from this bit plus the pack's own RPC.
    channels: () => channelPack,
    chanRelay: {
      status: chanRelayStatus,
      apply: async patch => {
        const current = settings.get().chanGateway ?? {}
        const relay = { ...(current.relay ?? {}) }
        if (patch === null || typeof patch !== 'object') throw httpError(400, 'the request body must be a JSON object')
        if (patch.enabled !== undefined) relay.enabled = patch.enabled === true
        if (patch.host !== undefined) {
          const host = String(patch.host ?? '').trim()
          if (host !== '' && host !== '127.0.0.1' && host !== 'localhost' && host !== '0.0.0.0' && host !== '::') {
            throw httpError(400, 'host must be one of 127.0.0.1, localhost, 0.0.0.0, ::')
          }
          relay.host = host === 'localhost' ? '127.0.0.1' : host
        }
        if (patch.port !== undefined) {
          const port = Number(patch.port)
          if (!Number.isInteger(port) || port < 0 || port > 65535) throw httpError(400, 'port must be an integer between 0 and 65535')
          relay.port = port
        }
        settings.update({ chanGateway: { ...current, relay } })
        settings.flush()
        await syncChanRelay()
        return chanRelayStatus()
      },
      key: () => chanRelayKey(),
      rotate: rotateChanRelayKey,
    },
    // The subscription URL is a credential: only its masked label ever leaves
    // this process. `active` mirrors what egressFetch is actually doing right
    // now (direct until the relay finishes starting, direct again once closed).
    egressInfo: () => ({
      running: outletRelay !== null,
      active: outletRelay !== null,
      mode: outletRelay?.mode ?? '',
      outlet: outletRelay === null ? '' : outletLabel(outletRelay.url ?? ''),
      // Cached readings: `/summary` is synchronous, so the live controller call
      // lives in `outletStatus` and only the last answer is echoed here.
      node: outletNode.node,
      nodeDelayMs: outletNode.delayMs,
      nodeAt: outletNode.at,
      // `dead` is the managed mihomo dying after startup — surfaced through the
      // same field so the settings page shows why traffic fell back to direct.
      error: outletError !== '' ? outletError : (outletRelay?.dead ?? ''),
    }),
    // The settings page polls this while the outlet is on: which node url-test is
    // carrying traffic on is mihomo's own state, and it changes without anything
    // else in this process moving.
    outletStatus: () => readOutletStatus(),
    syncEgress,
    dataDir,
    connection: fenceConnection,
    onAdmissionRejection: logAdmissionRejection('settings API'),
    logger,
  })

  // The dashboard half runs in its own fiber so that a composition without an
  // HTTP server cannot take the channels down with it.
  //
  // `ctx.inject(deps, callback)` is cordis' "run this once these services exist":
  // the callback pends while `webServer` is absent *or merely not provided yet*,
  // and is re-run if the service is replaced. That pending is the whole point —
  // reading `ctx.get('webServer')` once at apply time answered `undefined` in the
  // real web composition (plugins load before the browser half publishes it), the
  // routes never registered, and the settings page had no data source while a web
  // server was busy serving it.
  ctx.inject(['webServer'], scoped => {
    const server = scoped.webServer
    scoped.effect(() => server.register({ kind: 'prefix', path: '/api/our-free-model', handler: api }), 'our-free-model: api routes')
    logger.info?.('our-free-model: settings API mounted at /api/our-free-model')
  })

  // ── boot + teardown ─────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    void chanRelay?.close().catch(() => {})
    void outletRelay?.close().catch(() => {})
  }, 'our-free-model: local listeners')

  ctx.effect(() => () => {
    disposed = true
    settings.dispose()
  }, 'our-free-model: settings store')

  ctx.effect(() => {
    void (async () => {
      // The outlet first: the pack's requests go through egressFetch, so the exit
      // must be carrying traffic before anything else in this process goes out.
      await syncEgress()
      if (disposed) return
      await syncChanRelay()
      if (disposed) return
      await readOutletStatus().catch(() => {})
    })().catch(error => logger.warn?.(`our-free-model: startup failed (${error?.message ?? error})`))
  }, 'our-free-model: boot')

  /**
   * Keep `/summary`'s cached outlet reading fresh.
   *
   * The panel polls `/outlet` itself while it is open; this loop exists for the
   * case where nothing is open and the next mount must not render yesterday's
   * node. One unref'd timer, re-armed after each read, on purpose: `ctx.interval`
   * is a mixin over the undeclared `timer` service and reading it throws.
   */
  let outletTimer = null
  ctx.effect(() => {
    const arm = () => {
      outletTimer = setTimeout(() => {
        if (disposed) return
        if (outletRelay === null) { arm(); return }
        void readOutletStatus().catch(() => {}).finally(arm)
      }, 120_000)
      outletTimer.unref?.()
    }
    arm()
    return () => clearTimeout(outletTimer)
  }, 'our-free-model: outlet reading')
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * An error the settings API presents with its own status line, not a bare 500.
 * Used where a refusal is the *correct* answer, so the page can say why instead
 * of blaming a fault.
 */
function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function pick(source, keys) {
  const out = {}
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key]
  return out
}

/** The most a browser-API request body may weigh. The settings patch is the
 *  largest real payload here; without a cap, any caller past the fence could
 *  buffer unbounded bytes into the host process. */
const MAX_API_BODY_BYTES = 1024 * 1024

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_API_BODY_BYTES) throw httpError(413, 'request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(text) } catch (error) {
    // A body that was sent but is not JSON is a client bug, not "no body":
    // answering {} made POST /settings a silent 200 no-op. Empty bodies stay
    // legal ({} above) because no-body POSTs are real routes here.
    throw httpError(400, `invalid JSON body (${error?.message ?? error})`)
  }
}

function publicSettings(settings, egressInfo) {
  return {
    // A subscription link is not an endpoint, it is a bearer credential: the
    // path of the URL *is* the token. Stored as given, but never echoed —
    // `urlLabel` is the masked host for the panel, `hasUrl` says whether one is
    // set at all, and the value itself is served only by `GET /egress/url`, on
    // the settings page's own ask (see src/egress.js `outletLabel`).
    egress: {
      ...pick(settings.egress ?? {}, ['enabled', 'mode', 'mihomoPath']),
      hasUrl: String(settings.egress?.url ?? '') !== '',
      urlLabel: outletLabel(settings.egress?.url ?? ''),
      outlet: egressInfo?.outlet ?? '',
      running: egressInfo?.running === true,
      active: egressInfo?.active === true,
      // The node url-test is carrying traffic on, and its last measured delay.
      // Both are readings, not state.
      node: egressInfo?.node ?? '',
      nodeDelayMs: egressInfo?.nodeDelayMs ?? 0,
      error: egressInfo?.error ?? '',
    },
  }
}

function buildSummary(deps) {
  return {
    settings: publicSettings(deps.settings.get(), deps.egressInfo()),
    outlet: deps.egressInfo(),
    version: deps.version,
    // Whether the absorbed channel pack is live on this host, and its failure
    // reason when it is not (see the mount in `apply`). The page that renders the
    // channel grid reads this before the pack's own RPC answers.
    channels: deps.channels?.() ?? { state: 'unknown', error: '' },
  }
}

/**
 * The settings pages' HTTP surface.
 *
 * Every route runs the trust fence first: the connection service's own
 * admission when the composition mounts it (the same check the kernel applies
 * to `/api`), otherwise the structural replica in src/trust.js. The plugin's
 * prefix outranks `/api` in webServer's longest-prefix dispatch, so without
 * this fence these routes would answer callers the app itself would refuse.
 *
 * Only the four surviving pages are served. The ledger and the request log come
 * from the pack over the shell's `connection` RPC, so there is no `/stats` here,
 * and nothing in this fork refreshes a catalog.
 */
function createApiRoutes(deps) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const routePath = url.pathname.replace(/^\/api\/our-free-model/, '').replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()
    const rejection = rejectionFor(req, deps.connection, deps.onAdmissionRejection)
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    }
    if (rejection !== undefined) return send(rejection, {
      error: rejection === 401 ? 'unauthorized' : rejection === 503 ? 'admission unavailable' : 'forbidden',
    })
    try {
      if (method === 'GET' && routePath === '/summary') {
        return send(200, buildSummary(deps))
      }
      if (method === 'GET' && routePath === '/outlet') {
        return send(200, await deps.outletStatus())
      }
      if (method === 'GET' && routePath === '/egress/url') {
        return send(200, { url: deps.settings.get().egress?.url ?? '' })
      }
      if (method === 'POST' && routePath === '/settings') {
        const patch = await readJson(req)
        const current = deps.settings.get()
        const next = {}
        if (patch.egress !== undefined) {
          const egressPatch = pick(patch.egress, ['enabled', 'mode', 'url', 'mihomoPath'])
          if (egressPatch.mode !== undefined && egressPatch.mode !== 'subscription' && egressPatch.mode !== 'client') {
            return send(400, { error: 'the egress mode is "subscription" or "client"' })
          }
          for (const key of ['url', 'mihomoPath']) {
            if (egressPatch[key] !== undefined) {
              const value = String(egressPatch[key]).trim()
              if (value.length > 2048) return send(400, { error: `the egress ${key} is too long` })
              egressPatch[key] = value
            }
          }
          const egress = { ...(current.egress ?? {}), ...egressPatch }
          if (egress.enabled === true && String(egress.url ?? '') === '') {
            return send(400, { error: 'the outlet needs a subscription or proxy URL' })
          }
          next.egress = egress
        }
        deps.settings.update(next)
        deps.settings.flush()
        await deps.syncEgress()
        return send(200, { ok: true, settings: publicSettings(deps.settings.get(), deps.egressInfo()) })
      }
      // The channels' gateway relay (the pack's loopback OpenAI endpoint,
      // re-exposed under this plugin's own key). Status never carries a secret;
      // the key routes are read by the same fence as every other route here.
      if (method === 'GET' && routePath === '/chan-gateway') {
        return send(200, deps.chanRelay.status())
      }
      if (method === 'POST' && routePath === '/chan-gateway/apply') {
        const body = await readJson(req)
        return send(200, await deps.chanRelay.apply(body))
      }
      if (method === 'GET' && routePath === '/chan-gateway/key') {
        return send(200, { key: deps.chanRelay.key() })
      }
      if (method === 'POST' && routePath === '/chan-gateway/rotate') {
        return send(200, { key: deps.chanRelay.rotate() })
      }
      return send(404, { error: 'not found' })
    } catch (error) {
      const status = Number(error?.statusCode)
      return send(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500, { error: String(error?.message ?? error) })
    }
  }
}
