#!/usr/bin/env node
/**
 * bin/water.mjs —— 水经验：挑一个**没回过**的帖子，发一句话术（默认 3 / +3 / 3333333 / 顶顶顶…）
 *
 * 为什么不走模型：内容固定，没有任何判断要做。起一个 headless 会话跑 LLM 是浪费，
 * 也会把「发 3」这件事变得不可预测。
 *
 * 规矩（全部复用插件自己的闸）：
 *   · 先抢锁（water.lock）——cron、手动、面板三个入口可能同一秒撞上，抢不到就退出；
 *   · 今日额度用完 → 直接退出，不重试；
 *   · 两条间隔没到 → 直接退出，等下一轮；
 *   · 同帖只回一次（state.replied 记着，跨进程有效）；发之前再核一遍；
 *   · 只回「没回过」的帖子，自己发的不回。
 *
 * 输出：$DSH_HOME/zanao-market/water.log
 */
import fs from 'node:fs'
import path from 'node:path'
import * as zanao from '../lib/zanao.mjs'
import { readConfig } from '../lib/config.mjs'
import { readState, writeState, replyQuota, isLiked, markLiked, isLikedComment, markLikedComment, isBanned, markBan, parseBanUntil } from '../lib/state.mjs'
import { localStamp } from '../lib/time.mjs'

const log = (m) => {
  const line = `[${localStamp()}] water: ${m}\n`
  try { fs.appendFileSync(path.join(zanao.homeDir(), 'water.log'), line) } catch { /* ignore */ }
  process.stdout.write(line)
}

/* ------------------------------------------------------------ 锁 */
const lockPath = path.join(zanao.homeDir(), 'water.lock')
const LOCK_STALE_MS = 120_000

const acquireLock = () => {
  try {
    const fd = fs.openSync(lockPath, 'wx')
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`)
    fs.closeSync(fd)
    return true
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs
      if (age > LOCK_STALE_MS) { fs.unlinkSync(lockPath); return acquireLock() }
    } catch { return acquireLock() }
    return false
  }
}
const releaseLock = () => { try { fs.unlinkSync(lockPath) } catch { /* ignore */ } }

if (!acquireLock()) { log('另一轮正在跑（锁被占），跳过'); process.exit(0) }
process.on('exit', releaseLock)
process.on('SIGINT', () => process.exit(130))
process.on('uncaughtException', (e) => { log('崩了：' + (e && e.message)); process.exit(1) })

/* ------------------------------------------------------------ 闸 */
const cfg = readConfig({})
zanao.setCid(cfg.cid)
zanao.setGap(cfg.requestGapMs)

const st = readState()

// 禁言期：一条都不发，也不重试。上次被限流时每分钟重试了一百多次，纯属添乱。
if (isBanned(st)) {
  log(`还在禁言期（到 ${new Date(Number(st.banUntil)).toLocaleString('zh-CN')}），本轮不发`)
  process.exit(0)
}

const q = replyQuota(st, cfg)
if (q.left <= 0) { log(`今日额度用完（${st.replies}/${cfg.replyPerDay}），明天再说`); process.exit(0) }
if (q.waitSec > 0) { log(`两条之间还要等 ${q.waitSec}s（本轮间隔 ${q.gapSec}s），这轮跳过`); process.exit(0) }

/* ------------------------------------------------------------ 挑帖 */
const [latest, hot] = await Promise.all([
  zanao.list({ hot: 0 }).catch((e) => { log('拉最新失败：' + e.message); return [] }),
  zanao.list({ hot: 1 }).catch(() => []),
])

const seen = new Set()
const cands = []
for (const t of [...latest, ...hot]) {
  if (!t.id || seen.has(t.id)) continue
  seen.add(t.id)
  if (t.mine) continue
  if (st.replied && st.replied[t.id]) continue
  cands.push(t)
}
if (!cands.length) { log('没有没回过的帖子了（列表就这些）'); process.exit(0) }

cands.sort((a, b) => b.time - a.time)
const target = cands[0]

// 发之前再核一遍：锁外面可能刚有人回过这条
if (st.replied && st.replied[target.id]) { log(`tid=${target.id} 刚回过，这轮跳过`); process.exit(0) }

/* ------------------------------------------------------------ 说什么 */
const n = Number(st.water && st.water.count ? st.water.count : 0)
const pool = Array.isArray(cfg.replyTexts) ? cfg.replyTexts.filter(Boolean) : []
const lastText = (st.water && st.water.lastText) || ''
let text
if (pool.length) {
  const usable = pool.length > 1 ? pool.filter((x) => x !== lastText) : pool
  text = usable[Math.floor(Math.random() * usable.length)]
} else {
  const base = String(cfg.replyText || '3').trim()
  text = base === '3' && n % 2 === 1 ? '+3' : base
}

/* ------------------------------------------------------------ 发 */
try {
  await zanao.postComment(target.id, text)
} catch (e) {
  log(`发失败 tid=${target.id}：${e.message}`)
  if (e.code === 10) {
    const until = parseBanUntil(e.message)
    markBan(st, until, e.message)
    writeState(st)
    log(`记下禁言：到 ${new Date(until).toLocaleString('zh-CN')} 之前不再发`)
  }
  process.exit(1)
}

// 写完重读一次再落盘，别把别处刚写的 state 覆盖掉
const fresh = readState()
fresh.replies = Number(st.replies || 0) + 1
fresh.lastReplyAt = Date.now()
fresh.replied = { ...(st.replied || {}), [target.id]: new Date().toISOString() }
fresh.water = { count: n + 1, lastAt: new Date().toISOString(), lastText: text }
writeState(fresh)

log(`已发 "${text}" → ${target.id}「${target.title.slice(0, 20)}」（今日 ${fresh.replies}/${cfg.replyPerDay}）`)

/* ------------------------------------------------------------ 顺手点赞 */
// 点两处：这条自己发言的帖子（likeRepliedThread），和自己刚发的那条评论（likeOwnComment）。
// 服务端是幂等置位，重复点不会累加，state 里记一笔只是省请求。
if (cfg.autoLike) {
  const did = []
  if (cfg.likeRepliedThread && !isLiked(fresh, target.id)) {
    try {
      await zanao.likeThread(target.id)
      markLiked(fresh, target.id)
      did.push('帖')
    } catch (e) { log(`点赞帖子失败 tid=${target.id}：${e.message}`) }
  }
  if (cfg.likeOwnComment) {
    try {
      const cid = await zanao.myCommentId(target.id, { content: text })
      if (cid && !isLikedComment(fresh, cid)) {
        await zanao.likeComment(target.id, cid)
        markLikedComment(fresh, cid)
        did.push('自己的评论')
      }
    } catch (e) { log(`点赞自己的评论失败 tid=${target.id}：${e.message}`) }
  }
  if (did.length) {
    writeState(fresh)
    log(`顺手点了赞：${did.join(' + ')}`)
  }
}