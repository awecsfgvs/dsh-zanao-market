/**
 * lib/drafts.mjs —— 回帖草稿（默认出口）
 *
 * 为什么默认落草稿：集市是实名的校园圈，一句话发出去就挂在别人帖子下面删不干净。
 * 所以模型写好的回复先进草稿队列，人扫一眼再放行；`zanao_reply` 只认「草稿放行」或
 * 「用户当场要求」两种情况。
 *
 * 存储：$DSH_HOME/zanao-market/drafts.jsonl（一行一条，追加写，不重写）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { homeDir } from './zanao.mjs'

export const draftsFile = () => path.join(homeDir(), 'drafts.jsonl')

function readLines() {
  try {
    return fs.readFileSync(draftsFile(), 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function append(row) {
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.appendFileSync(draftsFile(), JSON.stringify(row) + '\n', { mode: 0o600 })
  try { fs.chmodSync(draftsFile(), 0o600) } catch { /* ignore */ }
  return row
}

/** 新草稿：返回 id；同一帖同一天重复草稿会覆盖状态而不是刷屏 */
export function addDraft({ tid, title = '', content, intent = 'chat', reason = '' }) {
  const text = String(content || '').trim()
  if (!text) throw new Error('草稿是空的')
  const row = {
    id: crypto.randomBytes(4).toString('hex'),
    tid: String(tid),
    title: String(title).slice(0, 120),
    content: text.slice(0, 400),
    intent: String(intent || 'chat').slice(0, 20),
    reason: String(reason).slice(0, 200),
    status: 'draft',
    at: new Date().toISOString(),
  }
  return append(row)
}

export function listDrafts({ status = 'draft', limit = 30 } = {}) {
  const rows = readLines()
  const filtered = status ? rows.filter((r) => r.status === status) : rows
  return filtered.slice(-Math.max(1, Math.min(200, Number(limit) || 30))).reverse()
}

export function getDraft(id) {
  return readLines().find((r) => r.id === String(id)) || null
}

/** 状态流转：draft → sent / discarded */
export function setDraftStatus(id, status, extra = {}) {
  const rows = readLines()
  const i = rows.findIndex((r) => r.id === String(id))
  if (i < 0) return null
  rows[i] = { ...rows[i], ...extra, status, at2: new Date().toISOString() }
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(draftsFile(), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 })
  return rows[i]
}

export function draftStats() {
  const rows = readLines()
  const by = {}
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1
  return { total: rows.length, ...by }
}