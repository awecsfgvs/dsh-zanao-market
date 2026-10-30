/**
 * lib/reports.mjs —— 日报（一天一份 markdown）
 * 位置：$DSH_HOME/zanao-market/reports/YYYY-MM-DD.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './zanao.mjs'
import { today } from './state.mjs'

export const reportsDir = () => path.join(homeDir(), 'reports')
export const reportFile = (date = today()) => path.join(reportsDir(), `${date}.md`)

export function writeReport(content, date = today()) {
  const text = String(content || '').trim()
  if (!text) throw new Error('日报是空的')
  fs.mkdirSync(reportsDir(), { recursive: true })
  fs.writeFileSync(reportFile(date), text + '\n', 'utf8')
  return { ok: true, date, path: reportFile(date), bytes: Buffer.byteLength(text) }
}

export function readReport(date = today()) {
  try {
    return { date, path: reportFile(date), content: fs.readFileSync(reportFile(date), 'utf8') }
  } catch {
    return { date, path: reportFile(date), content: '', missing: true }
  }
}

export function listReports(limit = 20) {
  try {
    return fs.readdirSync(reportsDir())
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort().reverse().slice(0, limit)
      .map((f) => {
        const st = fs.statSync(path.join(reportsDir(), f))
        return { date: f.replace('.md', ''), bytes: st.size, mtime: st.mtime.toISOString() }
      })
  } catch { return [] }
}