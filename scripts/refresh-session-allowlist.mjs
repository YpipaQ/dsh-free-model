#!/usr/bin/env node
/**
 * 把 subagent 白名单**全量刷新**到所有已存在的会话。
 *
 *     node scripts/refresh-session-allowlist.mjs --dry-run   # 只看会改什么
 *     node scripts/refresh-session-allowlist.mjs --apply     # 真改（自动备份）
 *     node scripts/refresh-session-allowlist.mjs --verify    # 只核对结果
 *
 * ## 为什么需要它
 *
 * DSH 的 subagent 白名单是**会话级快照**：会话诞生时写一条
 * `subagent/model-selection-policy` 事件，之后永不更新：
 *
 *     apply: (policy, event) => {
 *       if (policy !== null || ...) return policy;   // 一旦非 null，后续全部忽略
 *     }
 *
 * ⇒ 改 `cordis.patch.yml` 只影响**未来新建**的会话；已有会话永远停在创建那天的白名单。
 * 本脚本直接改会话事件，把它们对齐到当前配置。
 *
 * ## 安全性设计
 *
 * 1. **逐帧处理**：会话文件是 zstd 多帧追加日志（一帧可含多行）。只解压/替换/重压
 *    **含目标事件的那些帧**，其余帧**原样字节保留** —— 不做整体解压重压。
 * 2. **只改第一条**：投影只在 `policy === null` 时接受事件，所以改**第一条**才有效；
 *    追加新事件是死代码。
 * 3. **先备份**：`--apply` 前把整个会话目录复制到 `~/.dsh/.allowlist-backup/<时间戳>/`。
 * 4. **可回滚**：备份目录结构与会话目录一致，`cp -a` 即可还原。
 * 5. **幂等**：已是目标白名单的会话直接跳过，不重写。
 *
 * ## ⚠️ 必须重启 DSH 才生效
 *
 * 运行中的进程在**内存里**持有会话事件和投影 cell；改磁盘不会让运行中的会话重新折叠。
 * ⇒ `--apply` 之后**完全退出 DSH 再启动**，已存在会话才会拿到新白名单。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SESSIONS_ROOT = path.join(os.homedir(), '.dsh', 'sessions')
const PROFILE_PATCH = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
const BACKUP_ROOT = path.join(os.homedir(), '.dsh', '.allowlist-backup')
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** 目标事件的类型串（在会话 JSONL 里逐字节出现）。 */
const POLICY_TYPE = 'subagent/model-selection-policy'

const argv = new Set(process.argv.slice(2))
const DRY = argv.has('--dry-run')
const APPLY = argv.has('--apply')
const VERIFY = argv.has('--verify')
if (!DRY && !APPLY && !VERIFY) {
  console.error('用法: --dry-run | --apply | --verify（三者选一）')
  process.exit(2)
}

// ── 1. 从 profile patch 读出目标白名单 ────────────────────────────────────────
/**
 * 极简 YAML 读取：只取 `subagent-model-selection-settings` 下的 `allowedModels`。
 *
 * ⚠️ 刻意不引入 yaml 依赖（本脚本要在纯 Node 环境跑，仓库不该为此加运行时依赖）。
 * 代价是格式受限：只认 `- provider: X` + `  model: Y` 两行一组。
 * ⇒ 解析不出任何条目时**直接报错退出**，不静默用空列表（那会把所有会话改成不可用）。
 */
function readTargetRoutes() {
  const text = fs.readFileSync(PROFILE_PATCH, 'utf8')
  const at = text.indexOf('subagent-model-selection-settings')
  if (at < 0) throw new Error(`在 ${PROFILE_PATCH} 里找不到 subagent-model-selection-settings`)
  const routes = []
  for (const line of text.slice(at).split('\n')) {
    const p = /^\s*- provider:\s*(\S+)\s*$/.exec(line)
    const m = /^\s*model:\s*(\S+)\s*$/.exec(line)
    if (p !== null) routes.push({ provider: p[1], model: '' })
    else if (m !== null && routes.length > 0 && routes.at(-1).model === '') routes.at(-1).model = m[1]
    // 遇到下一个顶层条目就停（allowedModels 段已结束）
    else if (/^- id:/.test(line) && routes.length > 0) break
  }
  const valid = routes.filter((r) => r.provider !== '' && r.model !== '')
  if (valid.length === 0) throw new Error('目标白名单解析为空 —— 拒绝执行（否则会把所有会话改成无法使用）')
  return valid
}

const TARGET = readTargetRoutes()
const TARGET_KEY = TARGET.map((r) => `${r.provider}/${r.model}`).sort().join(',')

// ── 2. 帧工具 ────────────────────────────────────────────────────────────────
/** 把 zstd 多帧文件切成独立帧（按 magic 分片）。 */
function splitFrames(buf) {
  const starts = []
  let pos = 0
  for (;;) {
    const i = buf.indexOf(ZSTD_MAGIC, pos)
    if (i < 0) break
    starts.push(i)
    pos = i + 1
  }
  starts.push(buf.length)
  const frames = []
  for (let k = 0; k < starts.length - 1; k += 1) {
    frames.push(buf.subarray(starts[k], starts[k + 1]))
  }
  return frames
}

const zstdDec = (buf) => execFileSync('zstd', ['-dc'], { input: buf, maxBuffer: 256 * 1024 * 1024 })
const zstdEnc = (buf) => execFileSync('zstd', ['-q', '-c'], { input: buf, maxBuffer: 256 * 1024 * 1024 })

/**
 * 处理一个会话文件，返回 { changed, note }。
 *
 * ⚠️ 只在**第一条** policy 事件所在帧动刀：投影的 `apply` 一旦把 state 变成数组，
 * 后续 policy 事件就被无条件忽略 ⇒ 改后面的没用。
 */
function processSession(file) {
  const original = fs.readFileSync(file)
  const frames = splitFrames(original)
  let changedAny = false
  let sawPolicy = false
  const outFrames = []

  for (const frame of frames) {
    if (!sawPolicy) {
      let text
      try { text = zstdDec(frame).toString('utf8') } catch { text = '' }
      if (text.includes(POLICY_TYPE)) {
        const lines = text.split('\n')
        let touched = false
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i].trim()
          if (line === '' || !line.includes(POLICY_TYPE)) continue
          let event
          try { event = JSON.parse(line) } catch { continue }
          if (event.type !== POLICY_TYPE) continue
          // 第一条 policy 事件：这里就是唯一有效的那条
          sawPolicy = true
          const current = Array.isArray(event.data?.allowedModels)
            ? event.data.allowedModels.map((r) => `${r.provider}/${r.model}`).sort().join(',')
            : ''
          if (current === TARGET_KEY) return { changed: false, note: '已是目标白名单' }
          event.data = { ...event.data, allowedModels: TARGET }
          lines[i] = JSON.stringify(event)
          touched = true
          break   // 只改这一条，同帧后续 policy 事件保持原样（反正投影也忽略）
        }
        if (touched) {
          outFrames.push(zstdEnc(Buffer.from(lines.join('\n'), 'utf8')))
          changedAny = true
          continue
        }
      }
    }
    outFrames.push(frame)   // 不相关帧：**原样字节保留**
  }

  if (!sawPolicy) return { changed: false, note: '无 policy 事件' }
  if (!changedAny) return { changed: false, note: '未命中可改行' }
  if (APPLY) {
    const merged = Buffer.concat(outFrames)
    // ⚠️ 先写临时文件再 rename：中途崩溃不会留下半个会话文件。
    const tmp = `${file}.tmp-allowlist`
    fs.writeFileSync(tmp, merged)
    fs.renameSync(tmp, file)
  }
  return { changed: true, note: `${TARGET.length} 条` }
}

// ── 3. 遍历 ──────────────────────────────────────────────────────────────────
const sessionFiles = []
for (const workspace of fs.readdirSync(SESSIONS_ROOT)) {
  const dir = path.join(SESSIONS_ROOT, workspace)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const id of fs.readdirSync(dir)) {
    const f = path.join(dir, id, 'session.v4.jsonl.zstd')
    if (fs.existsSync(f)) sessionFiles.push(f)
  }
}

console.log(`目标白名单（${TARGET.length} 条，来自 ${path.basename(PROFILE_PATCH)}）:`)
for (const r of TARGET) console.log(`  ${r.provider}/${r.model}`)
console.log(`\n扫描 ${sessionFiles.length} 个会话文件${DRY ? '（dry-run，不写入）' : APPLY ? '（将写入）' : '（仅核对）'}…\n`)

if (APPLY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(BACKUP_ROOT, stamp)
  fs.mkdirSync(dest, { recursive: true })
  execFileSync('cp', ['-a', SESSIONS_ROOT, path.join(dest, 'sessions')], { maxBuffer: 1024 * 1024 * 1024 })
  console.log(`已备份到 ${dest}\n`)
}

let changed = 0
let skipped = 0
let failed = 0
for (const file of sessionFiles) {
  const rel = path.relative(SESSIONS_ROOT, file)
  try {
    const r = processSession(file)
    if (r.changed) { changed += 1; console.log(`✓ ${rel}  ${r.note}`) }
    else { skipped += 1; if (VERIFY || DRY) console.log(`· ${rel}  ${r.note}`) }
  } catch (error) {
    failed += 1
    console.error(`✗ ${rel}  ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`\n合计: 改动 ${changed} / 跳过 ${skipped} / 失败 ${failed}`)
if (failed > 0) {
  console.error('\n⚠️ 有文件处理失败。若已 --apply，从上面的备份目录 cp -a 还原即可。')
  process.exit(1)
}
if (APPLY) {
  console.log('\n⚠️ 必须**完全退出 DSH 再启动**才生效（运行中的进程把会话和投影放在内存里）。')
}
