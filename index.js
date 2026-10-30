/**
 * dsh-zanao-market —— 主机半端
 * ============================================================================
 * 刷赞噢校园集市：读几页帖子 → 挑值得看的 → 写日报；签到可选；回帖默认只落草稿。
 *
 * 三条红线（和刷贴吧一个口径）：
 *   1. 默认只读。回帖要开 `autoReply`（或当场 force），且**必须**带 confirm；
 *      `draftOnly` 开着时，还得先有草稿、再显式 approved —— 模型不直接对外说话。
 *   2. 回帖有硬上限：每天 N 条、两条之间至少 M 秒、同帖一天一次。
 *   3. 凭证只存本地 `$DSH_HOME/zanao-market/token.txt`（600），不回显、不进日志、不进配置。
 *
 * 接口走 Web 端 c.zanao.com/sc-api/（无签名，带 user_token 即可读写）。
 */
import { defineTool as hostDefineTool } from './lib/toolkit.mjs'
import * as zanao from './lib/zanao.mjs'
import { readConfig, writeConfig, DEFAULTS } from './lib/config.mjs'
import { readState, writeState, freshState, pruneSeen, markSeen, isSeen, replyQuota, today } from './lib/state.mjs'
import { addDraft, listDrafts, getDraft, setDraftStatus, draftStats } from './lib/drafts.mjs'
import { writeReport, readReport, listReports } from './lib/reports.mjs'
import { runRound, readLog, logFile, startHeartbeat, heartbeatFresh } from './lib/runner.mjs'
import { localStamp, localToday, isValley, nextValley, fmtWhen } from './lib/time.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

let VERSION = '0.0.0'
try { VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version } catch { /* ignore */ }

export const name = 'zanao-market'
export const inject = ['tools', 'settings']

const log = (...a) => console.log('[zanao-market]', ...a)

let lastError = null
const noteError = (where, e) => {
  lastError = { at: localStamp(), where, message: String((e && e.message) || e) }
  log(`出错（${where}）：${lastError.message}`)
}

function resolvePersona(cfg) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const f = String(cfg.personaFile || '').trim()
  if (f) {
    const abs = path.isAbsolute(f) ? f : path.join(home, 'zanao-market', f)
    try { return { source: abs, text: fs.readFileSync(abs, 'utf8').slice(0, 20000) } } catch {
      return { source: abs, text: '', error: '人设文件读不到：' + abs }
    }
  }
  return { source: '', text: String(cfg.personaText || '') }
}

const mask = (s) => (s ? s.slice(0, 4) + '…' + s.slice(-4) : '')

/**
 * 自动跑一轮靠 `dsh` 子进程 —— 先确认它真的能起。
 * 桌面版自带的是 GUI，不一定有独立 CLI；没有就明说怎么补，别让定时器静默失败。
 */
let dshCache = null
function checkDsh(cfg, force = false) {
  if (!force && dshCache && Date.now() - dshCache.at < 5 * 60_000) return dshCache.value
  const bin = cfg.dshBin || process.env.DSH_BIN || 'dsh'
  let value = { bin, ok: false, error: '' }
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
    })
    value = { bin, ok: true, version: String(out).split('\n')[0].trim() }
  } catch (e) {
    value.error = e.code === 'ENOENT'
      ? `找不到 ${bin}：装独立 CLI（npm i -g @deepseek-ai/dsh）或在设置里把 dshBin 指到绝对路径`
      : String(e.message || e).slice(0, 200)
  }
  dshCache = { at: Date.now(), value }
  return value
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy() })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}
function sendJson(res, code, obj) {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  } catch { /* 连接没了 */ }
}

export function apply(ctx, config = {}) {
  const NO_SCHEDULE = process.env.ZANAO_MARKET_NO_SCHEDULE === '1'

  const cfgOf = () => {
    const c = readConfig(config)
    zanao.setCid(c.cid)
    zanao.setGap(c.requestGapMs)
    return c
  }

  const tool = (spec) => {
    const wrapped = {
      ...spec,
      execute: async (...a) => {
        try { return await spec.execute(...a) } catch (e) { noteError('工具 ' + spec.name, e); throw e }
      },
    }
    try { ctx.tools.register(hostDefineTool(wrapped)) } catch (e) {
      log(`工具 ${spec.name} 没注册上（不影响别的）：${e?.message ?? e}`)
    }
  }
  const json = (v) => v

  /* ------------------------------------------------------------ 状态 / 配置 */

  /** 状态快照：工具和设置页共用一份，省得两边口径不一样 */
  const statusOf = async () => {
    const cfg = cfgOf()
    const st = readState()
    const q = replyQuota(st, cfg)
    const next = cfg.valleyOnly ? nextValley(new Date(), { noonBusy: !cfg.noon, afternoonBusy: true }) : new Date()
    return {
      version: VERSION,
      cid: cfg.cid,
      token: zanao.hasToken() ? `已存（${mask(zanao.getToken())}）` : '没有',
      today: { date: st.date, replies: st.replies || 0, quotaLeft: q.left, waitSec: q.waitSec },
      autoReply: cfg.autoReply,
      draftOnly: cfg.draftOnly,
      drafts: draftStats(),
      autoRun: cfg.autoRun,
      round: { state: heartbeatFresh() ? 'running' : 'idle', last: st.lastRound || null },
      headless: checkDsh(cfg),
      nextWindow: fmtWhen(next),
      log: logFile(),
    }
  }

  tool({
    name: 'zanao_status',
    description: '刷赞噢集市的状态：登录、学校、今日回帖额度、草稿数、上一轮、下次窗口。排障先看它。',
    parameters: {},
    execute: async () => json(await statusOf()),
  })

  tool({
    name: 'zanao_config',
    description: '读/改刷集市设置。不给 patch 就是读。可改：cid、keywords、readPerRound、dedupeDays、requestGapMs、autoReply、draftOnly、replyPerDay、replyGapSec、autoRun、runHour、valleyOnly、personaText、personaFile、styleSamples。',
    parameters: {
      patch: { type: 'object', description: '要改的字段（可省）', additionalProperties: true },
    },
    execute: async ({ patch } = {}) => {
      if (!patch || !Object.keys(patch).length) return json(cfgOf())
      const next = writeConfig(patch, config)
      log(`配置已更新：${Object.keys(patch).join(', ')}`)
      return json(next)
    },
  })

  tool({
    name: 'zanao_login',
    description: '存 user_token 并验证。token 来自抓包：c.zanao.com 请求里的 user_token（base64 样式）。只写本地文件，不回显。',
    parameters: {
      token: { type: 'string', description: 'user_token 的值（也接受整条 Cookie）', required: true },
    },
    execute: async ({ token }) => {
      const len = zanao.setToken(String(token || ''))
      const p = await zanao.probe()
      return json({ ok: p.ok, tokenLen: len, steps: p.steps })
    },
  })

  tool({
    name: 'zanao_whoami',
    description: '看集市那边登录的是谁（昵称、等级、学校）。token 过期会直接报 errno 20。',
    parameters: {},
    execute: async () => {
      const d = await zanao.me()
      const u = (d && d.user_info) || d || {}
      return json({
        nickname: u.nickname || u.user_name || '',
        level: u.user_level ?? '',
        levelTitle: u.user_level_title || '',
        school: u.school_name || u.school || '',
        cid: zanao.getCid(),
      })
    },
  })

  /* ------------------------------------------------------------ 读 */

  tool({
    name: 'zanao_list',
    description: '拉集市帖子列表（默认按热度）。返回标题/摘要/评论数/时间，标出读过的（seen）。只有约 96 小时内的帖，翻不过去。',
    parameters: {
      hot: { type: 'number', description: '1=按热度（默认），0=按最新' },
      limit: { type: 'number', description: '返回几条（默认 10，最多 50）' },
      onlyFresh: { type: 'boolean', description: '只返回没读过的（默认 false）' },
      fromTime: { type: 'number', description: '翻页游标：上一页最后一条的 time' },
    },
    execute: async ({ hot = 1, limit = 10, onlyFresh = false, fromTime = 0 } = {}) => {
      const cfg = cfgOf()
      const all = await zanao.list({ hot: Number(hot) ? 1 : 0, fromTime: Number(fromTime) || 0 })
      const st = readState()
      const rows = all
        .filter((t) => !(cfg.ignoreMine && t.mine))
        .map((t) => ({ ...t, seen: isSeen(st, t.id, cfg.dedupeDays) }))
      const fresh = rows.filter((r) => !r.seen)
      const picked = (onlyFresh ? fresh : rows).slice(0, Math.max(1, Math.min(50, Number(limit) || 10)))
      return json({ total: rows.length, fresh: fresh.length, items: picked })
    },
  })

  tool({
    name: 'zanao_thread',
    description: '读一个帖子的正文 + 评论（默认前 10 条）。读完会标记为已读。判断内容靠它，别看标题下结论。',
    parameters: {
      tid: { type: 'string', description: '帖子 id', required: true },
      comments: { type: 'number', description: '带几条评论（默认 10，0=不带）' },
    },
    execute: async ({ tid, comments = 10 } = {}) => {
      const cfg = cfgOf()
      const { detail, tSign } = await zanao.info(tid)
      const out = {
        id: String(tid),
        title: detail.title || '',
        content: detail.content || '',
        cate: detail.cate_name || '',
        user: detail.nickname || '',
        time: zanao.fmtTs(detail.post_time || detail.p_time),
        views: detail.view_count ?? 0,
        comments: [],
        tSign: Boolean(tSign),
      }
      const n = Math.max(0, Math.min(50, Number(comments) || 0))
      if (n && tSign) {
        try { out.comments = (await zanao.comments(tid, tSign)).slice(0, n) } catch (e) {
          out.commentsError = e.message
        }
      }
      const st = readState()
      markSeen(st, tid)
      pruneSeen(st, cfg.dedupeDays)
      writeState(st)
      return json(out)
    },
  })

  /* ------------------------------------------------------------ 草稿（默认出口） */

  tool({
    name: 'zanao_draft',
    description: '把打算回的话存成草稿（不发出）。这是默认出口：模型写、人过目、再放行。',
    parameters: {
      tid: { type: 'string', description: '帖子 id', required: true },
      content: { type: 'string', description: '回复正文（≤400 字，人话，别客服腔）', required: true },
      title: { type: 'string', description: '帖子标题（方便人扫草稿箱）' },
      intent: { type: 'string', description: 'chat/share/joke/answer，默认 chat' },
      reason: { type: 'string', description: '为什么回这句（一句话）' },
    },
    execute: async ({ tid, content, title = '', intent = 'chat', reason = '' } = {}) => {
      const d = addDraft({ tid, content, title, intent, reason })
      return json({ ok: true, draft: d, hint: '草稿不会自己发；人看过再 zanao_reply({draftId, confirm:true, approved:true})' })
    },
  })

  tool({
    name: 'zanao_drafts',
    description: '列草稿箱（默认只列待审的 draft）。',
    parameters: {
      status: { type: 'string', description: 'draft（默认）/ sent / discarded / all' },
      limit: { type: 'number', description: '几条（默认 20）' },
    },
    execute: async ({ status = 'draft', limit = 20 } = {}) => {
      const rows = listDrafts({ status: status === 'all' ? '' : status, limit })
      return json({ count: rows.length, items: rows })
    },
  })

  /* ------------------------------------------------------------ 写（回帖） */

  tool({
    name: 'zanao_reply',
    description: '在集市帖子里发一条评论。必须 confirm:true；autoReply 关着时还要 force:true；draftOnly 开着时必须 draftId + approved:true。受每日条数/间隔/同帖去重三道闸。',
    parameters: {
      tid: { type: 'string', description: '帖子 id', required: true },
      content: { type: 'string', description: '正文（≤400 字）；给了 draftId 可省，用草稿的内容' },
      draftId: { type: 'string', description: '草稿 id：发草稿箱里那一条，发完标 sent' },
      intent: { type: 'string', description: 'chat/share/joke/answer，默认 chat' },
      anon: { type: 'boolean', description: '匿名（默认 false）' },
      replyTo: { type: 'string', description: '楼中楼：被回复的 comment id（省=直接评论帖子）' },
      rootId: { type: 'string', description: '楼中楼：所在层的 comment id' },
      confirm: { type: 'boolean', description: '必须 true：表示用户同意发出去' },
      approved: { type: 'boolean', description: 'draftOnly 模式下必须 true：人看过草稿并放行' },
      force: { type: 'boolean', description: '用户当场让你发（越过 autoReply 总闸）' },
    },
    execute: async ({ tid, content = '', draftId = '', anon = false, replyTo = '', rootId = '', confirm = false, approved = false, force = false } = {}) => {
      const cfg = cfgOf()
      if (confirm !== true) return json({ ok: false, error: '没有 confirm:true 就不发（公开内容，用主人的号）' })
      if (!cfg.autoReply && force !== true) {
        return json({ ok: false, error: 'autoReply 是关的：先在 zanao_config 打开，或用户当场要求时传 force:true' })
      }
      const draft = draftId ? getDraft(draftId) : null
      if (draftId && !draft) return json({ ok: false, error: `草稿 ${draftId} 不存在` })
      if (cfg.draftOnly && approved !== true) {
        return json({ ok: false, error: 'draftOnly 开着：先把话落 zanao_draft，人看过再带 approved:true 发' })
      }
      const text = String(content || draft?.content || '').trim()
      if (!text) return json({ ok: false, error: '正文空着' })
      if (text.length > 400) return json({ ok: false, error: `太长（${text.length} 字）` })

      const st = readState()
      const q = replyQuota(st, cfg)
      if (q.left <= 0) return json({ ok: false, error: `今天的额度用完了（${st.replies}/${q.cap}）`, quota: q })
      if (q.waitSec > 0) return json({ ok: false, error: `两条之间还要等 ${q.waitSec} 秒`, quota: q })
      const sameDay = st.replied?.[String(tid)]
      if (sameDay && String(sameDay).slice(0, 10) === today()) {
        return json({ ok: false, error: '这个帖子今天已经回过一条了（同帖一天一次）' })
      }

      const r = await zanao.postComment(tid, text, {
        replyCommentId: replyTo || '0',
        rootCommentId: rootId || replyTo || '0',
        useAnon: anon ? 1 : 0,
      })
      st.replies = Number(st.replies || 0) + 1
      st.lastReplyAt = Date.now()
      st.replied = { ...(st.replied || {}), [String(tid)]: new Date().toISOString() }
      writeState(st)
      if (draft) setDraftStatus(draft.id, 'sent', { sentAt: new Date().toISOString() })
      log(`已回帖 tid=${tid}（今天第 ${st.replies} 条）`)
      return json({ ok: true, tid: String(tid), chars: text.length, todayReplies: st.replies, quotaLeft: replyQuota(st, cfg).left, ...r })
    },
  })

  /* ------------------------------------------------------------ 日报 */

  tool({
    name: 'zanao_report_write',
    description: '写今天的集市日报（覆盖同一天）。',
    parameters: {
      content: { type: 'string', description: '整份 markdown', required: true },
      date: { type: 'string', description: 'YYYY-MM-DD（默认今天）' },
    },
    execute: async ({ content, date } = {}) => json(writeReport(content, date || localToday())),
  })

  tool({
    name: 'zanao_report_read',
    description: '读日报：默认今天；latest:true 读最近一份。',
    parameters: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      latest: { type: 'boolean', description: '读最近一份' },
    },
    execute: async ({ date, latest } = {}) => {
      if (latest) {
        const all = listReports(1)
        if (!all.length) return json({ content: '', missing: true })
        return json(readReport(all[0].date))
      }
      return json(readReport(date || localToday()))
    },
  })

  tool({
    name: 'zanao_reports',
    description: '列出已有的日报。',
    parameters: {},
    execute: async () => json({ items: listReports(30) }),
  })

  /* ------------------------------------------------------------ 人设 / 自检 / 跑一轮 */

  tool({
    name: 'zanao_persona',
    description: '读人设与语气样本。回帖前必须读它，照着样本的长短和口气写。',
    parameters: {},
    execute: async () => {
      const cfg = cfgOf()
      const p = resolvePersona(cfg)
      return json({ ...p, styleSamples: cfg.styleSamples })
    },
  })

  tool({
    name: 'zanao_selfcheck',
    description: '一次跑完自检：token / 学校 / 列表 / 本人信息。出问题先跑它。',
    parameters: {},
    execute: async () => json(await zanao.probe()),
  })

  tool({
    name: 'zanao_run',
    description: '立刻跑一轮（不等窗口）：起一个 headless 会话，把 prompts/duty.md 交给它。输出在 run.log。',
    parameters: {
      prompt: { type: 'string', description: '本轮附加要求（可省）' },
    },
    execute: async ({ prompt = '' } = {}) => {
      const cfg = cfgOf()
      if (!zanao.hasToken()) return json({ ok: false, error: '先 zanao_login 存 token' })
      const r = runRound({ cfg, trigger: 'manual', prompt })
      return json({ ok: r.started, ...r, log: logFile() })
    },
  })

  /* ------------------------------------------------------------ HTTP（设置页用） */

  const mountRoutes = (webServer) => {
    /** 只接受同源请求：本机别的页面带外来 Origin 一律 403；curl / 同源 fetch 放行 */
    const sameOrigin = (req) => {
      const origin = req.headers && req.headers.origin
      if (!origin) return true
      try { return new URL(origin).host === String((req.headers && req.headers.host) || '') } catch { return false }
    }
    try {
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/api/zanao-market',
        handler: async (req, res) => {
          if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: '跨站请求被拒（只接受同源）' })
          const sub = new URL(req.url, 'http://127.0.0.1').pathname.replace('/api/zanao-market', '') || '/'
          try {
            if (sub === '/status' && req.method === 'GET') return sendJson(res, 200, await statusOf())
            if (sub === '/config' && req.method === 'GET') return sendJson(res, 200, cfgOf())
            if (sub === '/config' && req.method === 'POST') {
              const b = await readBody(req)
              return sendJson(res, 200, writeConfig(b, config))
            }
            if (sub === '/token' && req.method === 'POST') {
              const b = await readBody(req)
              const len = zanao.setToken(String(b.token || ''))
              return sendJson(res, 200, { ok: true, tokenLen: len, ...(await zanao.probe()) })
            }
            if (sub === '/selfcheck' && req.method === 'GET') return sendJson(res, 200, await zanao.probe())
            if (sub === '/run' && req.method === 'POST') {
              const b = await readBody(req)
              const r = runRound({ cfg: cfgOf(), trigger: 'manual', prompt: String(b.prompt || '') })
              return sendJson(res, 200, { ok: r.started, ...r })
            }
            return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${sub}` })
          } catch (e) {
            noteError('HTTP ' + sub, e)
            return sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
          }
        },
      }), 'zanao-market: /api/zanao-market 路由')
      log('HTTP 路由已挂载：/api/zanao-market')
    } catch (e) { log(`HTTP 路由没挂上：${e?.message ?? e}`) }
  }

  let mounted = false
  const takeServer = () => {
    try {
      const s = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
      return s || ctx.webServer
    } catch { return undefined }
  }
  const tryMount = () => {
    if (mounted) return true
    const srv = takeServer()
    if (!srv) return false
    mountRoutes(srv)
    mounted = true
    return true
  }
  if (typeof ctx.inject === 'function') {
    try { ctx.inject(['webServer'], (c) => { mounted = true; mountRoutes(c.webServer) }) } catch { /* 退到轮询 */ }
  }
  if (!tryMount() && !mounted) {
    const timer = setInterval(() => { try { if (tryMount()) clearInterval(timer) } catch { /* 继续等 */ } }, 1000)
    timer.unref?.()
    if (typeof ctx.effect === 'function') ctx.effect(() => () => clearInterval(timer), 'zanao-market: 等 webServer 就绪')
  }

  /* ------------------------------------------------------------ 设置页 */

  if (typeof ctx.settings?.register === 'function') {
    try {
      ctx.settings.register({ name: 'zanao-market', config: { ...DEFAULTS } })
    } catch (e) { log(`设置项没注册上：${e?.message ?? e}`) }
  }

  /* ------------------------------------------------------------ 定时 */

  if (!NO_SCHEDULE) {
    startHeartbeat('') // 占位：主进程不写心跳，子进程才写；这里只为统一路径
    const tick = () => {
      try {
        const cfg = cfgOf()
        if (!cfg.autoRun) return
        const st = readState()
        if (st.lastRunDate === localToday()) return
        const h = new Date().getHours()
        if (h < cfg.runHour) return
        if (cfg.valleyOnly && !isValley(new Date(), { noonBusy: !cfg.noon, afternoonBusy: true })) return
        if (heartbeatFresh()) return
        const r = runRound({ cfg, trigger: 'auto', prompt: '' })
        if (r.started) {
          const s2 = readState()
          s2.lastRunDate = localToday()
          s2.lastRound = { at: new Date().toISOString(), trigger: 'auto', pid: r.pid }
          writeState(s2)
          log('自动一轮已起')
        }
      } catch (e) { noteError('定时 tick', e) }
    }
    const timer = setInterval(tick, 10 * 60_000)
    timer.unref?.()
    setTimeout(tick, 45_000).unref?.()
    log(`定时器已启动（autoRun=${readConfig(config).autoRun}）`)
  } else {
    startHeartbeat(process.env.ZANAO_ROUND_ID || '')
  }

  log(`已加载 v${VERSION}；token=${zanao.hasToken() ? '有' : '无'}；cid=${zanao.getCid()}`)
}