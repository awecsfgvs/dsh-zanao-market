#!/usr/bin/env node
/**
 * bin/like.mjs —— 补赞：把自己**发过的帖**和**回过言的帖**点赞一遍
 *
 * 为什么不跟回帖放一起：回帖时点的是「刚刚那条」，历史帖子得靠这一趟补。
 * 规矩复用同一套：
 *   · 抢锁（like.lock），cron 与手动撞上时只跑一个；
 *   · 服务端是幂等置位，重复点不会累加，state.liked 记着只是省请求；
 *   · 一轮最多点 MAX_PER_RUN 个，按 requestGapMs 慢慢来，别把风控招来；
 *   · autoLike 关着就一声不响退出。
 *
 * 输出：$DSH_HOME/zanao-market/like.log
 */
import fs from 'node:fs'
import path from 'node:path'
import * as zanao from '../lib/zanao.mjs'
import { readConfig } from '../lib/config.mjs'
import { readState, writeState, isLiked, markLiked, isBanned, markBan, parseBanUntil } from '../lib/state.mjs'
import { localStamp } from '../lib/time.mjs'

const MAX_PER_RUN = 25

const log = (m) => {
  const line = `[${localStamp()}] like: ${m}\n`
  try { fs.appendFileSync(path.join(zanao.homeDir(), 'like.log'), line) } catch { /* ignore */ }
  process.stdout.write(line)
}

const lockPath = path.join(zanao.homeDir(), 'like.lock')
const LOCK_STALE_MS = 300_000
const acquireLock = () => {
  try {
    const fd = fs.openSync(lockPath, 'wx')
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`)
    fs.closeSync(fd)
    return true
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lockPath); return acquireLock() }
    } catch { return acquireLock() }
    return false
  }
}
const releaseLock = () => { try { fs.unlinkSync(lockPath) } catch { /* ignore */ } }

if (!acquireLock()) { log('另一轮正在跑（锁被占），跳过'); process.exit(0) }
process.on('exit', releaseLock)
process.on('uncaughtException', (e) => { log('崩了：' + (e && e.message)); process.exit(1) })

const cfg = readConfig({})
if (!cfg.autoLike) { log('autoLike 关着，不点'); process.exit(0) }
zanao.setCid(cfg.cid)
zanao.setGap(cfg.requestGapMs)

const st = readState()
if (isBanned(st)) { log('还在禁言期，这轮不点'); process.exit(0) }
const todo = []
const push = (id, why) => {
  const tid = String(id || '')
  if (!tid || isLiked(st, tid)) return
  if (todo.some((x) => x.tid === tid)) return
  todo.push({ tid, why })
}

// 1. 自己发的帖（列表里 is_mine）
if (cfg.likeOwnThread) {
  try {
    const [a, b] = await Promise.all([
      zanao.list({ hot: 0 }).catch(() => []),
      zanao.list({ hot: 1 }).catch(() => []),
    ])
    for (const t of [...a, ...b]) if (t.mine) push(t.id, '自己的帖')
  } catch (e) { log('拉列表失败：' + e.message) }
}

// 2. 自己回过言的帖（state.replied 里记着）
if (cfg.likeRepliedThread) {
  for (const tid of Object.keys(st.replied || {})) push(tid, '回过言的帖')
}

if (!todo.length) { log('没有要补的赞（都点过了）'); process.exit(0) }

let ok = 0
let fail = 0
for (const { tid, why } of todo.slice(0, MAX_PER_RUN)) {
  try {
    await zanao.likeThread(tid)
    markLiked(st, tid)
    ok++
    log(`已点赞 ${tid}（${why}）`)
  } catch (e) {
    fail++
    log(`点赞失败 ${tid}：${e.message}`)
    if (e.code === 10) { markBan(st, parseBanUntil(e.message), e.message); break }
    if (e.code === 20) break
  }
}
writeState(st)
log(`这一轮：成 ${ok} / 败 ${fail} / 待办还剩 ${Math.max(0, todo.length - MAX_PER_RUN)}`)
