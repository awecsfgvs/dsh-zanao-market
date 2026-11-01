/**
 * lib/zanao.mjs —— 赞噢校园集市 Web 端客户端（c.zanao.com/sc-api/）
 *
 * 为什么走 Web 端（而不是小程序 / App）：
 *   · Web 端**没有全局签名**，带 user_token 就能读写；小程序要 X-Sc-Ah（盐公开但没必要），
 *     App 端盐藏在 libAes.so 里，逆不出来；
 *   · 写接口（thread/post、comment/post）同样不签名 —— 这是能自动回帖的前提。
 *
 * 三套 token 不通用：这里只用 Web 的 user_token，存 $DSH_HOME/zanao-market/token.txt（600）。
 * 不进 config.json、不进日志、不进工具返回值。
 *
 * 已知服务端行为（来自实测 + fairarchive/ZanaoPaPaPa 的记录）：
 *   · errno=0 成功；errno=3 路径不存在（"sorry, illegal request"）；errno=20 未登录；
 *   · /thread/v2/list 只回约 96 小时内（~650 帖），翻不过去；
 *   · /thread/info 要 t_sign 才能接着读评论，t_sign 就返回在同一个响应里。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BASE = 'https://c.zanao.com/sc-api/'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class ZanaoError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ZanaoError'
    this.code = code
  }
}

export function homeDir() {
  const h = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(h, 'zanao-market')
}
export const tokenFile = () => path.join(homeDir(), 'token.txt')

let CID = 'ncwu'
let GAP = 1500
export function setCid(v) {
  const s = String(v || '').trim().toLowerCase()
  if (/^[a-z0-9_-]{2,32}$/.test(s)) CID = s
}
export const getCid = () => CID

export function setGap(ms) {
  const n = Number(ms)
  if (Number.isFinite(n)) GAP = Math.max(300, Math.min(8000, Math.round(n)))
}
export const getGap = () => GAP

export function getToken() {
  try { return fs.readFileSync(tokenFile(), 'utf8').trim() } catch { return '' }
}
export const hasToken = () => getToken().length >= 20

export function setToken(raw) {
  const v = String(raw || '').replace(/\s+/g, '')
  if (!v) throw new Error('空着就保存了：把 user_token 粘进来（抓包时 c.zanao.com 请求里的那串）')
  if (/^cookie:/i.test(v) || /user_token=/i.test(v)) {
    const m = v.match(/user_token=([^;,\s]+)/)
    if (!m) throw new Error('这段像整条 Cookie，但里面没有 user_token= —— 复制值就行')
    return setToken(m[1])
  }
  if (!/^[A-Za-z0-9+/=_\-]{20,300}$/.test(v)) {
    throw new Error(`这串不像 user_token（长度 ${v.length}）—— 值是 base64 样式的，别把请求头整行贴进来`)
  }
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(tokenFile(), v + '\n', { mode: 0o600 })
  try { fs.chmodSync(tokenFile(), 0o600) } catch { /* Windows 上无所谓 */ }
  return v.length
}

export function clearToken() {
  try { fs.unlinkSync(tokenFile()) } catch { /* 本来就没有 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastAt = 0

function errText(code, msg) {
  if (code === 3) return '这个接口路径不对（errno 3）—— 可能是 cid 拼错或接口改版了'
  if (code === 20) return '登录失效了（errno 20）—— user_token 过期，重新抓一次'
  if (code === 401) return '登录失效了（errno 401）'
  return `集市返回错误 ${code}${msg ? '：' + msg : ''}`
}

async function request(method, p, { params, form } = {}) {
  const tok = getToken()
  if (!tok) throw new ZanaoError('还没有 user_token：先在设置里粘贴（zanao_login）', 'NO_TOKEN')

  const u = new URL(BASE + p)
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v))
  }

  const wait = GAP - (Date.now() - lastAt)
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()

  const headers = {
    'User-Agent': UA,
    'X-Sc-Alias': CID,
    'X-Sc-Platform': 'web',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://c.zanao.com/',
    Accept: 'application/json, text/plain, */*',
    Cookie: `user_token=${tok}`,
  }
  let body
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(
      Object.entries(form || {}).filter(([, v]) => v !== undefined && v !== null),
    ).toString()
  }

  let res
  try {
    res = await fetch(u, { method, headers, body })
  } catch (e) {
    throw new ZanaoError(`网络请求失败：${e.message}`, 'NET')
  }
  const txt = await res.text()
  let j
  try { j = JSON.parse(txt) } catch {
    throw new ZanaoError(`返回不是 JSON（HTTP ${res.status}）：${txt.slice(0, 120)}`, 'NOT_JSON')
  }
  const code = Number(j.errno)
  if (Number.isFinite(code) && code !== 0) throw new ZanaoError(errText(code, j.errmsg), code)
  return j.data ?? j
}

/* ------------------------------------------------------------------ 读 */

/** 学校信息（不需要登录也能看到一部分，但带着 token 更完整） */
export function community() {
  return request('GET', 'community/info', { params: { cid: CID } })
}

/** 列表：from_time=0 拉最新；hot=1 按热度。服务端只回约 96 小时。 */
export async function list({ fromTime = 0, hot = 0 } = {}) {
  const d = await request('GET', 'thread/v2/list', {
    params: { from_time: fromTime || 0, hot, isIOS: 'false' },
  })
  const arr = Array.isArray(d) ? d : (d && Array.isArray(d.list) ? d.list : [])
  return arr.map(normThread).filter((t) => t.id)
}

/** 帖子详情 + t_sign（读评论要它） */
export async function info(id) {
  const tid = String(id)
  const d = await request('POST', 'thread/info', {
    form: { id: tid, url: `https://c.zanao.com/thread/${tid}`, from: 'cate', isIOS: 'false' },
  })
  return { detail: d && d.detail ? d.detail : {}, tSign: (d && d.t_sign) || '', raw: d }
}

/** 评论列表：sign 必须用 info() 拿到的 t_sign，否则只会回空 */
export async function comments(id, tSign, { rcid = 0, vuid = 0 } = {}) {
  const d = await request('GET', 'comment/list', {
    params: { id: String(id), rcid, vuid, sign: tSign },
  })
  const arr = Array.isArray(d) ? d : (d && Array.isArray(d.list) ? d.list : [])
  return arr.map((c) => ({
    id: String(c.comment_id ?? c.id ?? ''),
    user: String(c.nickname ?? c.user_name ?? ''),
    content: String(c.content ?? ''),
    time: Number(c.p_time ?? c.post_time ?? 0),
    like: Number(c.like_num ?? 0) || 0,
    replyTo: c.reply_to || c.ruser_name || '',
    isReply: Boolean(c.is_reply ?? c.rcid),
    rcid: String(c.rcid ?? c.root_comment_id ?? 0),
    mine: Boolean(c.is_mine),
    likeHas: Boolean(c.like_has),
  }))
}

/** 我是谁（user/info 固定 from=mine，不接受别人的 id） */
export async function me() {
  return request('GET', 'user/info', { params: { from: 'mine' } })
}

/* ------------------------------------------------------------------ 写 */

/**
 * 发评论。参数名照 Web/小程序同一套后端：
 *   id / content / reply_comment_id / root_comment_id / use_anon / from=detail
 * 层主回复（直接评论帖子）：reply_comment_id=0, root_comment_id=0
 * 楼中楼：reply_comment_id=被回复那条，root_comment_id=所在层
 */
export async function postComment(
  id,
  content,
  { replyCommentId = '0', rootCommentId = '0', useAnon = 0 } = {},
) {
  const text = String(content || '').trim()
  if (!text) throw new ZanaoError('内容空着就不发了', 'EMPTY')
  if (text.length > 400) throw new ZanaoError(`内容太长（${text.length} 字，集市上限 400）`, 'TOO_LONG')
  const d = await request('POST', 'comment/post', {
    form: {
      id: String(id),
      content: text,
      reply_comment_id: String(replyCommentId || 0),
      root_comment_id: String(rootCommentId || 0),
      use_anon: Number(useAnon) ? 1 : 0,
      from: 'detail',
    },
  })
  return { ok: true, data: d }
}

/** 发帖（默认不用；留个口子给「求购/出物」这类真需求） */
export async function postThread({
  title,
  content,
  cateId = '1',
  imgPaths = '',
  contact = {},
  commentClose = 0,
} = {}) {
  const t = String(title || '').trim()
  const c = String(content || '').trim()
  if (!t) throw new ZanaoError('标题空着', 'EMPTY')
  if (!c) throw new ZanaoError('正文空着', 'EMPTY')
  const d = await request('POST', 'thread/post', {
    form: {
      contact_person: contact.person || '',
      contact_phone: contact.phone || '',
      contact_qq: contact.qq || '',
      contact_wx: contact.wx || '',
      title: t,
      content: c,
      img_paths: imgPaths,
      cate_id: String(cateId),
      certShow: 10,
      is_comment_close: Number(commentClose) ? 1 : 0,
    },
  })
  return { ok: true, data: d }
}

/**
 * 点赞 / 取消点赞。服务端是「幂等置位」，重复点同一目标不会累加，所以拿走丢人的风险很低。
 *   POST thread/like   id=<帖>&comment_id=0&action=1
 *   POST comment/like  id=<帖>&comment_id=<评论>&action=1
 * action=0 是取消 —— 只在明确要撤的时候用。
 */
export async function likeThread(id, { action = 1 } = {}) {
  const tid = String(id || '')
  if (!tid) throw new ZanaoError('帖子 id 空着', 'EMPTY')
  const d = await request('POST', 'thread/like', {
    form: { id: tid, comment_id: 0, action: Number(action) ? 1 : 0 },
  })
  return { ok: true, liked: Number(action) !== 0, tid, data: d }
}

export async function likeComment(id, commentId, { action = 1 } = {}) {
  const tid = String(id || '')
  const cid = String(commentId || '')
  if (!tid || !cid) throw new ZanaoError('帖子 id 或评论 id 空着', 'EMPTY')
  const d = await request('POST', 'comment/like', {
    form: { id: tid, comment_id: cid, action: Number(action) ? 1 : 0 },
  })
  return { ok: true, liked: Number(action) !== 0, tid, cid, data: d }
}

/**
 * 找自己在这个帖子里刚发的那条评论的 id（发评论接口不回 id，只能回头找）。
 * 优先用 is_mine + 内容匹配 + 最新时间；都对不上就退回「最新一条自己的」。
 */
export async function myCommentId(id, { content = '' } = {}) {
  const { tSign } = await info(id)
  const list = await comments(id, tSign)
  const mine = list.filter((c) => c.mine)
  if (!mine.length) return ''
  const text = String(content || '').trim()
  const same = text ? mine.filter((c) => c.content === text) : mine
  const pool = (same.length ? same : mine).slice().sort((a, b) => b.time - a.time)
  return pool[0]?.id || ''
}

/* ------------------------------------------------------------------ 归一化 */

export function normThread(t = {}) {
  const id = String(t.thread_id ?? t.id ?? t.tid ?? '')
  return {
    id,
    title: String(t.title ?? '').trim(),
    content: String(t.content ?? '').trim(),
    cate: String(t.cate_name ?? ''),
    cateId: String(t.cate_id ?? ''),
    comments: Number(t.c_count ?? 0) || 0,
    views: Number(t.view_count ?? 0) || 0,
    likes: Number(t.l_count ?? 0) || 0,
    time: Number(t.p_time ?? t.post_time ?? 0) || 0,
    timeText: fmtTs(Number(t.p_time ?? t.post_time ?? 0)),
    user: String(t.nickname ?? ''),
    mine: Boolean(t.is_mine),
    hot: Number(t.hot_val ?? 0) || 0,
    finish: Boolean(t.finish_status),
  }
}

export function fmtTs(sec) {
  if (!sec) return ''
  const d = new Date(Number(sec) * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 自检用：一次只读探测，返回每一步的成败 */
export async function probe() {
  const out = { token: hasToken(), cid: CID, steps: [] }
  const step = async (name, fn) => {
    try { const r = await fn(); out.steps.push({ name, ok: true, hint: r }); return r } catch (e) {
      out.steps.push({ name, ok: false, error: `${e.code ?? ''} ${e.message}`.trim() })
      return null
    }
  }
  const c = await step('community/info', async () => {
    const d = await community()
    const ci = d && d.community_info ? d.community_info : {}
    return String(ci.community_name || ci.school_name || '').slice(0, 40)
  })
  out.community = c || ''
  const l = await step('thread/v2/list', async () => `${(await list({ hot: 1 })).length} 条`)
  out.listCount = Number(String(l || '0').replace(/\D/g, '')) || 0
  await step('user/info', async () => {
    const d = await me()
    const u = d && d.user_info ? d.user_info : d
    return String((u && (u.nickname || u.user_name)) || '').slice(0, 30)
  })
  out.ok = out.steps.every((s) => s.ok)
  return out
}