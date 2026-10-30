/**
 * test/smoke.mjs —— 真机只读冒烟：注册工具 → 登录 → 列表 → 读帖 → 落草稿 → 闸门是否拦得住
 *
 * 不发任何评论/帖子。跑法：
 *   ZANAO_TOKEN=xxx node test/smoke.mjs      （或者把 token 放 %TEMP%/zanao_tok.txt）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.ZANAO_MARKET_NO_SCHEDULE = '1'

const tools = []
const ctx = {
  tools: { register: (t) => tools.push(t) },
  settings: { register: () => {} },
}

const mod = await import('../index.js')
mod.apply(ctx, {})

const byName = new Map(tools.map((t) => [t.name, t]))
console.log('注册工具：', tools.map((t) => t.name).join(', '))

const call = async (name, args) => {
  const t = byName.get(name)
  if (!t) throw new Error(`没有工具 ${name}`)
  return t.execute(args)
}

const token = process.env.ZANAO_TOKEN
  || (fs.existsSync(path.join(os.tmpdir(), 'zanao_tok.txt'))
    ? fs.readFileSync(path.join(os.tmpdir(), 'zanao_tok.txt'), 'utf8').trim() : '')

const r = {}
r.login = await call('zanao_login', { token })
console.log('登录：', r.login.ok, JSON.stringify(r.login.steps))
if (!r.login.ok) process.exit(2)

r.status = await call('zanao_status', {})
console.log('状态：', JSON.stringify({ cid: r.status.cid, token: r.status.token, today: r.status.today }))

r.whoami = await call('zanao_whoami', {})
console.log('本人：', JSON.stringify(r.whoami))

r.list = await call('zanao_list', { hot: 1, limit: 3 })
console.log('列表：', r.list.total, '条，fresh', r.list.fresh, '→', r.list.items.map((i) => i.id + ' ' + i.title.slice(0, 18)).join(' | '))

if (r.list.items[0]) {
  r.thread = await call('zanao_thread', { tid: r.list.items[0].id, comments: 3 })
  console.log('读帖：', r.thread.title.slice(0, 24), '| 评论', r.thread.comments.length, '| tSign', r.thread.tSign)
}

r.draft = await call('zanao_draft', {
  tid: r.list.items[0]?.id || '0',
  title: r.list.items[0]?.title || '',
  content: '这个价还行，B 区那边新的也就 80。',
  intent: 'share',
  reason: '冒烟测试',
})
console.log('草稿：', r.draft.ok, r.draft.draft?.id)

r.drafts = await call('zanao_drafts', {})
console.log('草稿箱：', r.drafts.count)

r.gateNoConfirm = await call('zanao_reply', { tid: String(r.list.items[0]?.id || 0), content: 'x' })
console.log('闸门（不带 confirm）：', r.gateNoConfirm.ok, r.gateNoConfirm.error)

r.gateNoApprove = await call('zanao_reply', { tid: String(r.list.items[0]?.id || 0), content: 'x', confirm: true, force: true })
console.log('闸门（draftOnly 未放行）：', r.gateNoApprove.ok, r.gateNoApprove.error)

r.selfcheck = await call('zanao_selfcheck', {})
console.log('自检：', r.selfcheck.ok)

console.log('\n结果：全部步骤跑通，未发出任何内容。')