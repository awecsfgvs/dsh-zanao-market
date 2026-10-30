#!/usr/bin/env node
/**
 * bin/water.mjs —— 水经验：挑一个**没回过**的帖子，发一句 replyText（默认 3 / +3 交替）
 *
 * 为什么不走模型：内容固定，没有任何判断要做。起一个 headless 会话跑 LLM 是浪费，
 * 也会把「发 3」这件事变得不可预测。
 *
 * 规矩（全部复用插件自己的闸）：
 *   · 今日额度用完 → 直接退出，不重试；
 *   · 两条间隔没到 → 直接退出，等下一轮；
 *   · 同帖一天只回一次（state.replied 记着，跨进程有效）；
 *   · 只回「没回过」的帖子，自己发的不回。
 *
 * 输出：$DSH_HOME/zanao-market/water.log
 */
import fs from 'node:fs'
import path from 'node:path'
import * as zanao from '../lib/zanao.mjs'
import { readConfig } from '../lib/config.mjs'
import { readState, writeState, replyQuota } from '../lib/state.mjs'
import { localStamp } from '../lib/time.mjs'

const log = (m) => {
  const line = `[${localStamp()}] water: ${m}\n`
  try { fs.appendFileSync(path.join(zanao.homeDir(), 'water.log'), line) } catch { /* ignore */ }
  process.stdout.write(line)
}

const cfg = readConfig({})
zanao.setCid(cfg.cid)
zanao.setGap(cfg.requestGapMs)

const st = readState()
const q = replyQuota(st, cfg)
if (q.left <= 0) { log(`今日额度用完（${st.replies}/${cfg.replyPerDay}），明天再说`); process.exit(0) }
if (q.waitSec > 0) { log(`两条之间还要等 ${q.waitSec}s，这轮跳过`); process.exit(0) }

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

// 话术：池子非空就从池子里随机挑一句（别连着两句一样），否则用 replyText，并按 3 / +3 交替
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

try {
  await zanao.postComment(target.id, text)
} catch (e) {
  log(`发失败 tid=${target.id}：${e.message}`)
  process.exit(1)
}

st.replies = Number(st.replies || 0) + 1
st.lastReplyAt = Date.now()
st.replied = { ...(st.replied || {}), [target.id]: new Date().toISOString() }
st.water = { count: n + 1, lastAt: new Date().toISOString(), lastText: text }
writeState(st)

log(`已发 "${text}" → ${target.id}「${target.title.slice(0, 20)}」（今日 ${st.replies}/${cfg.replyPerDay}）`)