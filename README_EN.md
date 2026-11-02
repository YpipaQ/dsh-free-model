# Model Access (dsh-free-model)

**A DSH plugin** (DeepSeek Harness · cordis bundle) · [中文](https://github.com/YpipaQ/dsh-free-model/blob/slim-channels-only/README.md)

[![npm](https://img.shields.io/npm/v/dsh-free-model.svg)](https://www.npmjs.com/package/dsh-free-model)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-4C8BF5)](#)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/YpipaQ/dsh-free-model/blob/slim-channels-only/LICENSE)

> A trimmed fork of [`Ebony-Vinyl/dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model) **2.1.0** (commit `7e3a1da`).
> One lane survives: **bring your own account channels** — fifteen providers, plus a token dashboard,
> a per-request log and a local gateway. Upstream's anonymous free lane, the EAC co-paid lane, the
> aggregate lane, the token savers, the routing chains and the whole release/update channel are gone.
>
> ⚠️ The fork parent is **already at 2.3.0**, but nearly all of its later work sits in the lanes this fork
> deletes; **channel and model data come from the true upstream** (see "Credits and provenance" below).

| | |
| --- | --- |
| npm | **`dsh-free-model`** (same as the repository) |
| Settings entry | **模型接入** in Chinese, **Model Access** in English |
| Loader entry id | `our-free-model` — the settings namespace and the state directory hang off this id, so they do **not** move when the package name changes |
| State directory | `~/.dsh/our-free-model/` (0600) |

## Install

**CLI (plain dsh web) — recommended**

```bash
dsh plugin --profile web add dsh-free-model
```

Then **restart dsh once**: the host half lives inside the process, so only a restart loads the new
`index.js`; the browser half just needs a page refresh. `--profile` takes the profile you actually use
(`web` by default).

**Desktop (DSHEAC AIO)**: install through the **in-app plugin manager**. The desktop build gates the
profile before booting web — it only lets through links dsh itself created under `.dsh-module-fallback`,
and any other symlink or junction in the profile tree makes it refuse to start
(`PROFILE_UPGRADE_REQUIRED`). So **do not use `link:` dependencies and do not hand-make junctions**.

**Switching from upstream**: upstream publishes as `dsh-our-free-model`. Both packages use the loader
entry id `our-free-model`, so they **cannot be installed at the same time**:

```bash
dsh plugin --profile web remove dsh-our-free-model
dsh plugin --profile web add dsh-free-model
```

The state directory and the entry id are unchanged in this fork, so **accounts, credentials and the
outlet address survive the switch**.

**Uninstall / roll back**

```bash
dsh plugin --profile web remove dsh-free-model          # uninstall
dsh plugin --profile web add dsh-our-free-model         # roll back to upstream 2.1.0
```

> ⚠️ **Do not copy the checkout into `node_modules/<package>/` by hand.** Measured on 2026-10-11: such a
> copy is replaced from the lockfile — or pruned outright — by the next `pnpm install` the plugin manager
> runs (installing or removing *any* other plugin triggers one). To pin it long-term, use the registry
> (this package) or a `file:` dependency on a CLI web profile.

## Quick start

1. After the restart open **Settings → 模型接入 / Model Access** and log into each channel you want
   (browser authorization; the account pool and credit lookups live on the same card).
2. Every channel card lets you switch models on and off one by one, plus **show all / hide all** —
   **they may all start hidden**, and hidden models never reach the model picker.
3. Back in the chat composer's model picker the channel models appear grouped per product; pick one.

## What survives

Four settings pages (down from nine):

| Page | What it does |
| --- | --- |
| **Free channels** | Fifteen account cards — CodeArts, CodeBuddy / WorkBuddy (CN + intl), LobsterAI, Qoder / Qoder CN, TRAE, Cline, Loomy, Raccoon, MiniMax Code, ZCode, Gemini, **OfficeAce** (Huawei Cloud ModelArts, cloud-direct, no client install) and **Accio Work** (Alibaba, standard OAuth + PKCE, IDE-free): browser login, account pool, renewal, credit lookup and one-click claim, daily auto check-in, per-model switches, balance. |
| **Dashboard** | The pack's own per-request token ledger: today / all-time usage, average throughput, TTFT, cache hit rate, success rate, account pivot, per-model table. |
| **Request log** | Every request in detail: result, duration, TTFT, speed, token breakdown; hover a failed row for the reason. |
| **Gateway** | The pack's local OpenAI-compatible gateway (switch, endpoint, key, model count), this plugin's LAN relay (bind address/port, its own key, rotation), and the egress-outlet section. |

## What was removed and why

| Removed | Why |
| --- | --- |
| **Free models** page: the anonymous opencode lane + Kilo free pool | Third-party grey channel (client impersonation + pooled public credentials); can break at any time. |
| **EAC models** page: the GitHub-gated co-paid lane | Depends on the repository owner's gateway and a star grant. |
| **Aggregate** page (76 bring-your-own-key providers) | Served by the plugin's own adapter, which this fork removes. |
| **Token savers** page | The compaction pipeline runs inside that same adapter. |
| **Routing** page (combo fallback chains) | Same adapter. |
| Announcement centre, self-updater, hot reload | Upstream release signatures did not verify; and a fork should not let a remote party swap its bytes. |
| Local forward listener (18899) and the LAN forward | They forwarded the deleted lane. |
| `packages/standalone/`, `worker/`, `feed/`, `catalog/` | All three satellite products `import` the deleted lane; keeping them means shipping code that can never run. |

Sizes: `src/` went from **58 modules to 5** (`store/key/chan-relay/egress/trust`), the host `index.js`
from **2343 to 684 lines**, the browser half `client.js` from **5992 to 2538 lines**, and the offline
suites from 45 to **27**. Every `animation` and `@keyframes` rule is gone as well.

## Configuration

The only state file is `~/.dsh/our-free-model/settings.json` (0600); this fork reads three keys:

```json
{
  "egress": {
    "enabled": false,
    "mode": "subscription",
    "url": "",
    "mihomoPath": ""
  },
  "chanGateway": {
    "relay": { "enabled": false, "host": "127.0.0.1", "port": 18326, "key": "" }
  }
}
```

Other keys written by 2.1.0 (`enabled`, `forward`, `tokenSaver`, `aggregate`, `combos`,
`announcementsAcked`, …) are preserved but inert — `JsonStore` merges the file over the defaults, so
your outlet address and relay key survive an upgrade.

### HTTP surface

Everything goes through the trust fence, under `/api/our-free-model`:

```
GET  /summary              the document the four pages read (settings.egress / channels / version / outlet)
GET  /outlet               current outlet node and latency (a reading; failure is just a missing reading)
GET  /egress/url           the subscription URL itself — read only when the page asks to show/copy it
POST /settings             accepts the egress section only
GET  /chan-gateway         relay and gateway state (never the keys)
POST /chan-gateway/apply   change bind address/port
GET  /chan-gateway/key     the relay key, on demand
POST /chan-gateway/rotate  rotate the relay key
```

The dashboard and the request log **do not** go through here: the pack owns the per-request ledger and
the browser half talks to it over the shell's `connection` RPC (`usage.tokenLedger` /
`usage.tokenLedgerHistory`).

## Security

- **Credentials**: account tokens live in the pack's own credential store (`~/.dsh/.credentials.yaml`, 0600); the page never sees plaintext. The subscription URL is treated as a credential and read only when you ask to display it — ordinary payloads carry a masked host.
- **The LAN relay is the only listener facing outward**: off by default; when on it requires its own relay key (not shared with the local gateway key). **Anyone who can reach this machine can spend your channel quota** — enable it only on a trusted network, and firewall the source range if in doubt.
- **Trust fence**: the plugin's routes outrank the kernel's `/api`, so it carries the same admission check as the kernel — it reuses the composition's `connection` service when present, and otherwise falls back to a structural fence (loopback `Host`, no cross-site marker, same-origin `Origin`/`Referer`).
- **Egress audit**: see [`SECURITY-AUDIT.md`](https://github.com/YpipaQ/dsh-free-model/blob/slim-channels-only/SECURITY-AUDIT.md) — the verdict is **direct to each provider, no third-party relay, no telemetry**; it lists the fifteen providers' hosts with their TLS certificate subjects, the two non-vendor calls that carry no credentials, the local surface and the known risks. Re-run it with `node scripts/egress-audit.mjs --tls` (read-only; `--json` for machine output).

## Tests

```bash
npm test                            # 27 offline suites: no network, no quota
node scripts/host-smoke-test.mjs     # the host HTTP surface only
node scripts/client-lint.mjs         # the browser half only (dictionary keys, CSS reachability)
```

| Suite | Covers |
| --- | --- |
| `client-lint` | Browser half: registration, the two dictionaries agree key-for-key with no extras, every CSS rule is reachable, every emitted `ofm_*` class is defined |
| `client-render` | The four pages rendered for real against host-shaped payloads (catches references to deleted components) |
| `host-smoke` | The whole host HTTP surface: the four pages' data, outlet validation, relay key minting/rotation/persistence, **and that deleted routes 404** |
| `trust` / `chan-relay` / `egress` | Each host module's own contract |
| `channel-pack` / `channel-network` | Pack mounting, fifteen provider registrations, credits, image pricing, proxy and OAuth lifecycles |
| `channel-model-metadata` | The model metadata the picker reads: WorkBuddy's five efforts, Loomy `spark-x`'s window (**both the remote and fallback paths**), and the declared effort order with a default that must not flip |
| `channel-catalog` / `channel-catalog-heal` | Catalog-landing broadcast, `got` vs `complete`, bounded cold-start prewarm, and whether a **partial catalog heals** (real adapter, partial then complete) |
| `channel-gateway-source` | The gateway's synthesized messages carry a `source.kind` inside `dsh-llm`'s module-augmented vocabulary (**real gateway + real HTTP request**, read back from the `stream()` argument) |
| `channel-cline-dev` | Cline's models.dev catalog: `Accept-Encoding: br, gzip`, ETag conditional requests, **304 falling back to the previous result** (never an empty catalog), 60s timeout, and `supportsImage: false` preserved |
| `channel-officeace-lock` / `channel-officeace-login` | The ported OfficeAce channel: the login loop really goes through RPC (authorize URL → poll → token → persisted); the lock **decision and its execution** are asserted case by case (unlocked keeps the old path verbatim, locked-with-only-permanent must throw and never fall back to the pool) |
| `channel-accio` | The ported Accio channel: a callback-style login really goes through RPC (authorize page → local callback → token exchange → persisted under the **account's own ref**), plus the auto-renew table is asserted to cover accio / officeace (a missing entry = silently never renewed, with no log) |
| `channel-buddy-conv` | WorkBuddy/CodeBuddy: `send()` must emit three non-empty `X-Conversation-*` headers (without them, certain accounts get the whole channel dead on `400/11128` every turn); the channel-verification tier rotates accounts, **writes no cooldown**, and reports `PERMISSION_DENIED` pointing at the account; a single-account pool must not misreport `QUOTA_EXCEEDED`; 11140 still writes its cooldown |
| `channel-zcode-system-blocks` | ZCode's `system` array must stay at exactly 3 blocks (a 4th one ⇒ 405+3012); caller system goes into messages |
| `channel-zcode-405` | ZCode `405` is never retryable (classifying it as SERVER caused 5 pointless retries plus account-cooldown penalties) |
| `channel-officeace-checkin` | OfficeAce daily check-in: failures must log and release the hourly slot (otherwise the hour is pinned and the day's 1000 points are lost) |
| `channel-accio-rotate` | Accio per-request account rotation (402/429 rotate+cooldown, 401 rotate *without* cooldown, 400 does not rotate) |
| `channel-trae-image-order` | TRAE: tool-result images must come after all `tool` messages (otherwise 4027 permanently breaks the session) |
| `channel-catalog-refresh` | Model catalogue self-refresh (10 adapters expose `refreshCatalog`, a 30-minute timer keeps it fresh, failures keep the old catalogue) |
| `channel-credit-exhausted` / `channel-tool-args` / `channel-expiry-terminal` | 14018 credit exhaustion must not fall back to 1h / tool args triage (truncated vs invalid) / save-failure after a successful refresh is terminal, with per-provider error classes |
| `channel-fingerprint` | Tencent content-fingerprint rewriting: missing the assistant-body case means a poisoned history replays every turn — the session is dead **and switching to any other Tencent model does not help**; the allowlist is exactly buddy/workbuddy; benign text is left intact |

The other 37 of upstream's 45 suites tested lanes this fork deletes. The suites run **from a checkout
only** — the npm package does not ship `scripts/`.

## The channel pack

`vendor/channel-pack/` is a complete sub-project (its own `package.json`, TypeScript sources, tests and
build script); `pack.js` is its bundle:

```bash
npm run channel-pack      # rebuild from vendor/channel-pack/src (needs esbuild)
```

Provenance, licence and what was changed are in `vendor/channel-pack/NOTICE.md`; OpenCode account
access is switched off when the pack mounts.

## Credits and provenance

This plugin has two distinct lineages, and **both are other people's work**. Stated plainly here.

### ① The host and the overall shape: `Ebony-Vinyl/dsh-our-free-model` (the fork parent)

This repository is a trimmed fork of it. **The host half, the vendoring of the channel pack, and the
directory layout this fork still uses all come from there:**

| What it did | Where |
| --- | --- |
| The original plugin implementation (host + browser half + pack mounting) | [`Ebony-Vinyl/dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| Vendored the pack into `vendor/` and renamed it to `channel-pack` (dropping the upstream codename) | commit `7bc8068` (2026-10-07, by Ebony-Vinyl) — inherited verbatim by this fork |
| Switched off upstream OpenCode account access when mounting (this fork keeps that switch) | same commit |
| Licence and copyright | MIT, © 2026 **Ebony-Vinyl** (see this repo's [`LICENSE`](https://github.com/YpipaQ/dsh-free-model/blob/slim-channels-only/LICENSE)) |

⚠️ It is **not the data source for channels or model data** — it does not refresh that vendored copy
from the true upstream below on any fixed cadence, so model lists are always checked against ②.

The **host half's skeleton** (`index.js` / `client.js` / `src/*.js`) is its work — that is this fork's
starting point. ⚠️ **As of this version we have taken no host-side fixes from its 2.2/2.3**: those
changes sit in lanes and pages this fork deletes (free lane, EAC, the desktop shell, the plugin-upgrade
page), so they do not port. If it later lands a host fix in a lane we keep, we port it on its own.

One place where the **two upstreams disagree** is worth naming: for the gateway's own message
source identity, the parent uses `{ kind: 'plugin:dsh-openai-gateway' }` while the gitee upstream uses
a bare `kind` plus a `declare module` augmentation. This fork **chose the latter** — `dsh-llm` 0.2
deleted the shared `plugin` wrapper (verbatim: "no shared catch-all `plugin` kind"), and all ~20
`MessageSourceMap` augmentations in the harness use bare kebab-case with **no `plugin:` prefix
precedent**. The reasoning and the measurements are in the
`vendor/channel-pack/src/openai-gateway/messages.ts` comments.

### ② Channel and model data: Jet's channel pack (the true upstream)

Everything in `vendor/channel-pack/` — **the fifteen account channels' login, account pools,
credential renewal, credit claiming, model blacklists and the OpenAI gateway** — comes from one
upstream project. That is where this plugin's actual value lives:

- **Gitee repository**: `iJetLi/deepseek-harness-codearts` (upstream has since renamed it to **`dsh-providers-hub`**)
- **Author**: **Jet** (`iJetLi`)
- **Licence and copyright**: MIT, © 2026 **Jet** (see `vendor/channel-pack/LICENSE`)
- Commit absorbed by this fork: `345f0a07b22713c0ae189ca7d8b97ec4f64626c6` (2026-10-06); provenance and rebuild steps are in `vendor/channel-pack/NOTICE.md`

What we do on top is **surgical catch-up**: the current model efforts, the `spark-x` context window,
the declared effort order, and the catalog completeness/broadcast/prewarm work were all ported by
following Jet's measured findings one by one (the evidence for each change is in the source comments).
**Without his implementation, this plugin would not exist.**

Thanks too to the other contributors on both sides: these are multi-person projects, and the measured
records in their `git log` (browser captures, real-account retests, error-code attribution) are the
real reason these channels work at all.

## License

This repository is MIT (see [`LICENSE`](https://github.com/YpipaQ/dsh-free-model/blob/slim-channels-only/LICENSE));
the vendored channel pack is covered by `vendor/channel-pack/LICENSE` (© Jet) and `NOTICE.md`. All channel
accounts, quotas and credit rules belong to their providers — follow their terms of service.
