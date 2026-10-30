/**
 * lib/state.mjs —— 本地状态：今天回了几条、哪些帖读过、当前这一轮的计数
 *
 * 一个文件：$DSH_HOME/zanao-market/state.json
 * 「额度」是硬闸：每日条数、两条间隔、同帖一天一次，全从这儿算，不靠模型自觉。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './zanao.mjs'

export const stateFile = () => path.join(homeDir(), 'state.json')

export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function freshState() {
  return {
    date: today(),
    replies: 0,
    lastReplyAt: 0,
    seen: {},          // thread_id → ISO 时间
    seenComments: {},  // 回过的账号，避免连着回同一个人
    round: null,
  }
}

export function readState() {
  let s = {}
  try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) } catch { /* 还没有 */ }
  const st = { ...freshState(), ...s }
  // 跨天：条数清零，seen 保留（去重窗口按 dedupeDays 走）
  if (st.date !== today()) { st.date = today(); st.replies = 0 }
  st.seen = st.seen && typeof st.seen === 'object' ? st.seen : {}
  return st
}

export function writeState(s) {
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), { mode: 0o600 })
  try { fs.chmodSync(stateFile(), 0o600) } catch { /* ignore */ }
  return s
}

/** 清掉超过 N 天的 seen，别让文件越长越大 */
export function pruneSeen(st, days = 7) {
  const cut = Date.now() - Math.max(1, days) * 86400_000
  let n = 0
  for (const [k, v] of Object.entries(st.seen)) {
    const t = Date.parse(v)
    if (!Number.isFinite(t) || t < cut) { delete st.seen[k]; n++ }
  }
  return n
}

export function markSeen(st, ids) {
  const at = new Date().toISOString()
  for (const id of [].concat(ids)) if (id) st.seen[String(id)] = at
}

export function isSeen(st, id, days = 7) {
  const t = Date.parse(st.seen?.[String(id)] || '')
  if (!Number.isFinite(t)) return false
  return Date.now() - t < Math.max(1, days) * 86400_000
}

/** 回帖额度：0 表示今天已经满了，返回还要等多少秒 */
export function replyQuota(st, cfg) {
  const left = Math.max(0, Number(cfg.replyPerDay) - Number(st.replies || 0))
  const since = Date.now() - Number(st.lastReplyAt || 0)
  const waitSec = Math.max(0, Math.ceil((Number(cfg.replyGapSec) * 1000 - since) / 1000))
  return { left, waitSec, cap: Number(cfg.replyPerDay) }
}