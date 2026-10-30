/**
 * test/gates.mjs —— 离线闸门测试（CI 用，不连网、不需要 token）
 *
 * 验的是「不该发的时候一定发不出去」：
 *   1. 工具都注册上了；
 *   2. 没有 confirm 不发；
 *   3. draftOnly 没放行不发；
 *   4. 每日额度用完之后不发；
 *   5. 同帖一天只回一次；
 *   6. 配置越界会夹紧。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zanao-test-'))
process.env.DSH_HOME = tmpHome
process.env.ZANAO_MARKET_NO_SCHEDULE = '1'

const { apply } = await import('../index.js')
const { normalize } = await import('../lib/config.mjs')

const tools = []
const ctx = { tools: { register: (t) => tools.push(t) }, settings: { register: () => {} } }
apply(ctx, {})
const by = (n) => {
  const t = tools.find((x) => x.name === n)
  assert.ok(t, `工具 ${n} 没注册`)
  return t
}

// 1. 工具齐
const names = tools.map((t) => t.name).sort()
assert.equal(names.length, 15, `工具数不对：${names.length}`)
for (const n of ['zanao_status', 'zanao_config', 'zanao_login', 'zanao_whoami', 'zanao_list',
  'zanao_thread', 'zanao_draft', 'zanao_drafts', 'zanao_reply', 'zanao_report_write',
  'zanao_report_read', 'zanao_reports', 'zanao_persona', 'zanao_selfcheck', 'zanao_run']) {
  by(n)
}

// 2. 没有 confirm
const r1 = await by('zanao_reply').execute({ tid: '1', content: 'x' })
assert.equal(r1.ok, false)
assert.match(r1.error, /confirm/)

// 3. draftOnly 没放行
await by('zanao_config').execute({ patch: { autoReply: true, draftOnly: true } })
const r2 = await by('zanao_reply').execute({ tid: '1', content: 'x', confirm: true })
assert.equal(r2.ok, false)
assert.match(r2.error, /draftOnly|草稿/)

// 4/5. 额度与同帖：把 state 写到「今天已经满了」，再看是否拦
const { readState, writeState } = await import('../lib/state.mjs')
await by('zanao_config').execute({ patch: { draftOnly: false, autoReply: true, replyPerDay: 1, replyGapSec: 10 } })
const st = readState()
st.replies = 1
st.lastReplyAt = 0
writeState(st)
const r3 = await by('zanao_reply').execute({ tid: '1', content: 'x', confirm: true })
assert.equal(r3.ok, false)
assert.match(r3.error, /额度/)

st.replies = 0
st.replied = { 1: new Date().toISOString() }
writeState(st)
const r4 = await by('zanao_reply').execute({ tid: '1', content: 'x', confirm: true })
assert.equal(r4.ok, false)
assert.match(r4.error, /今天已经回过/)

// 6. 配置夹紧
const c = normalize({ readPerRound: 999, replyPerDay: -1, requestGapMs: 1, dedupeDays: 0 })
assert.equal(c.readPerRound, 30)
assert.equal(c.replyPerDay, 0)
assert.equal(c.requestGapMs, 300)
assert.equal(c.dedupeDays, 1)

// 草稿流
const d = await by('zanao_draft').execute({ tid: '1', content: '这价贵了，B 区新的才 80。' })
assert.equal(d.ok, true)
assert.equal((await by('zanao_drafts').execute({})).count, 1)

// 7. 设置页路由：挂得上、status 能返回、未知路径 404
const routes = []
const webServer = { register: (def) => { routes.push(def); return () => {} } }
apply({
  tools: { register: () => {} },
  settings: { register: () => {} },
  effect: (fn) => { const x = fn(); return () => x && x() },
  inject: (_deps, cb) => cb({ webServer }),
}, {})
assert.equal(routes.length, 1, `路由没挂上：${routes.length}`)
assert.equal(routes[0].path, '/api/zanao-market')

const call = async (method, url) => {
  let body = ''
  const res = { writeHead(c) { this.code = c }, end(t) { body += t } }
  await routes[0].handler({ method, url, headers: { host: '127.0.0.1' } }, res)
  return { code: res.code, body }
}
const rs = await call('GET', '/api/zanao-market/status')
assert.equal(rs.code, 200)
assert.ok(JSON.parse(rs.body).version.startsWith('0.1.'))
assert.equal((await call('GET', '/api/zanao-market/config')).code, 200)
assert.equal((await call('GET', '/api/zanao-market/nope')).code, 404)

fs.rmSync(tmpHome, { recursive: true, force: true })
console.log('gates ok：15 个工具 / 四道拒发 / 配置夹紧 / 草稿流 / 设置页路由 全部通过')