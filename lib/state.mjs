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
    liked: {},         // 点过赞的 thread_id → ISO 时间（服务端幂等，这里只是省请求）
    likedComments: {}, // 点过赞的 comment_id → ISO 时间
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

/**
 * 两条之间的**实际**间隔（秒）：replyGapSec 打底，再叠 [0, replyGapJitterSec] 的随机浮动。
 * 例如 60 + 120 → 每条落在 60~180 秒之间。
 * 随机量用 lastReplyAt 当种子：同一条回复之后算出来的间隔是固定的，
 * 不会每调用一次就重新掷骰子（否则 waitSec 会来回抖、面板数字乱跳）。
 */
export function gapSeconds(st, cfg) {
  const base = Math.max(1, Math.round(Number(cfg.replyGapSec) || 0))
  const jitter = Math.max(0, Math.round(Number(cfg.replyGapJitterSec) || 0))
  if (!jitter) return base
  let t = (Number(st.lastReplyAt || 0) >>> 0) || 0x9e3779b9
  t = (t + 0x6d2b79f5) >>> 0
  let r = Math.imul(t ^ (t >>> 15), 1 | t)
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
  const u = ((r ^ (r >>> 14)) >>> 0) / 4294967296
  return base + Math.floor(u * (jitter + 1))
}

export function isLiked(st, id) {
  return Boolean(st.liked?.[String(id)])
}
export function markLiked(st, id) {
  st.liked = st.liked && typeof st.liked === 'object' ? st.liked : {}
  st.liked[String(id)] = new Date().toISOString()
}
export function isLikedComment(st, id) {
  return Boolean(st.likedComments?.[String(id)])
}
export function markLikedComment(st, id) {
  st.likedComments = st.likedComments && typeof st.likedComments === 'object' ? st.likedComments : {}
  st.likedComments[String(id)] = new Date().toISOString()
}

/** 回帖额度：0 表示今天已经满了，返回还要等多少秒 */
export function replyQuota(st, cfg) {
  const left = Math.max(0, Number(cfg.replyPerDay) - Number(st.replies || 0))
  const gapSec = gapSeconds(st, cfg)
  const since = Date.now() - Number(st.lastReplyAt || 0)
  const waitSec = Math.max(0, Math.ceil((gapSec * 1000 - since) / 1000))
  return { left, waitSec, cap: Number(cfg.replyPerDay), gapSec }
}