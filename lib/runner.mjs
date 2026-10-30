/**
 * lib/runner.mjs —— 跑一轮（headless 子进程）
 *
 * 日报要模型写，插件里没有模型 —— 所以到点后起一个
 * `dsh --profile headless "<prompt>"`，把 prompts/duty.md 交给它，输出全量落盘。
 *
 * 保守设计（照抄刷贴吧那套，吃过亏的地方不再踩）：
 *   · 默认关（autoRun=false），要用户自己开；
 *   · 一天只跑一次（state.lastRunDate）；
 *   · 同一时间只允许一个（跨进程锁 + 心跳）；
 *   · 25 分钟超时直接杀掉；
 *   · 子进程里禁止再起调度器（ZANAO_MARKET_NO_SCHEDULE=1）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homeDir } from './zanao.mjs'
import { localStamp } from './time.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LOCK = () => path.join(homeDir(), 'round.lock')
export const logFile = () => path.join(homeDir(), 'run.log')
export const hbFile = () => path.join(homeDir(), 'hb.json')

export function acquireLock() {
  try {
    const j = JSON.parse(fs.readFileSync(LOCK(), 'utf8'))
    const pid = Number(j.pid)
    if (pid && Date.now() - Number(j.at || 0) < 40 * 60_000) {
      try { process.kill(pid, 0); return { ok: false, pid } } catch { /* 进程没了，可以接管 */ }
    }
  } catch { /* 没有锁 */ }
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(LOCK(), JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 })
  return { ok: true }
}

export function releaseLock() {
  try {
    const j = JSON.parse(fs.readFileSync(LOCK(), 'utf8'))
    if (Number(j.pid) === process.pid) fs.unlinkSync(LOCK())
  } catch { /* ignore */ }
}

/** headless 子进程里每 15 秒写一次心跳，主进程靠它判断「还活着」 */
export function startHeartbeat(roundId = '') {
  const write = () => {
    try {
      fs.mkdirSync(homeDir(), { recursive: true })
      fs.writeFileSync(hbFile(), JSON.stringify({ pid: process.pid, at: Date.now(), roundId: String(roundId) }), { mode: 0o600 })
    } catch { /* ignore */ }
  }
  write()
  const t = setInterval(write, 15_000)
  t.unref?.()
  const stop = () => { clearInterval(t); try { fs.unlinkSync(hbFile()) } catch { /* ignore */ } }
  process.once('exit', stop)
  return stop
}

export function heartbeatAt() {
  try { return JSON.parse(fs.readFileSync(hbFile(), 'utf8')) } catch { return null }
}

export function heartbeatFresh(ms = 90_000) {
  const h = heartbeatAt()
  return Boolean(h && Date.now() - Number(h.at || 0) < ms)
}

function appendLog(text) {
  try {
    fs.mkdirSync(homeDir(), { recursive: true })
    fs.appendFileSync(logFile(), text, 'utf8')
  } catch { /* ignore */ }
}

export function readLog(lines = 60) {
  try {
    const all = fs.readFileSync(logFile(), 'utf8').split('\n')
    return all.slice(-Math.max(1, lines)).join('\n')
  } catch { return '' }
}

export function readDutyPrompt() {
  const p = path.join(HERE, '..', 'prompts', 'duty.md')
  try { return fs.readFileSync(p, 'utf8') } catch { return '# 刷赞噢集市\n\n读几页帖子，写日报；回帖默认只落草稿。\n' }
}

/**
 * 跑一轮。返回 { started, pid } 或 { started:false, reason }。
 * 子进程输出全部进 run.log，不往宿主控制台灌。
 */
export function runRound({ cfg, trigger = 'manual', prompt = '' } = {}) {
  const lock = acquireLock()
  if (!lock.ok) return { started: false, reason: `已经有一轮在跑（pid ${lock.pid}）` }

  const bin = cfg?.dshBin || 'dsh'
  const profile = cfg?.headlessProfile || 'headless'
  const head = [
    `[${localStamp()}] 刷集市一轮（${trigger}）开始，profile=${profile}`,
  ].join('\n')
  appendLog(head + '\n')

  const body = (readDutyPrompt() + (prompt ? `\n\n## 本次追加要求\n${prompt}\n` : '')).slice(0, 60000)
  const args = ['--profile', profile, body]

  // Windows 上 `dsh` 多半是 .cmd 垫片：spawn 不能直接执行 .cmd，
  // 得交给 shell；但**只在需要时**走 shell —— 否则 Node 会警告「args + shell 有注入风险」，
  // 而且提示词里的换行/引号会被 shell 再吃一遍。
  const isWin = process.platform === 'win32'
  const needsShell = isWin && /\.(cmd|bat)$/i.test(String(bin))
  const winQuote = (s) => '"' + String(s).replace(/"/g, '\\"') + '"'

  let child
  try {
    const opts = {
      cwd: homeDir(),
      env: { ...process.env, ZANAO_MARKET_NO_SCHEDULE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
    child = needsShell
      ? spawn([bin, ...args].map(winQuote).join(' '), { ...opts, shell: true })
      : spawn(bin, args, opts)
  } catch (e) {
    releaseLock()
    appendLog(`[${localStamp()}] 起子进程失败：${e.message}\n`)
    return { started: false, reason: e.message }
  }

  const timer = setTimeout(() => {
    appendLog(`[${localStamp()}] 超过 25 分钟，杀掉 pid=${child.pid}\n`)
    try { child.kill('SIGKILL') } catch { /* ignore */ }
  }, 25 * 60_000)
  timer.unref?.()

  child.stdout.on('data', (b) => appendLog(String(b)))
  child.stderr.on('data', (b) => appendLog(String(b)))
  child.on('error', (e) => {
    const hint = e.code === 'ENOENT'
      ? `找不到 dsh（bin=${bin}）：装一个独立 CLI（npm i -g @deepseek-ai/dsh）或在设置里把 dshBin 指到它的绝对路径`
      : e.message
    appendLog(`[${localStamp()}] 子进程错误：${hint}\n`)
  })
  child.on('exit', (code) => {
    clearTimeout(timer)
    appendLog(`[${localStamp()}] 一轮结束 code=${code}\n\n`)
    releaseLock()
    try { fs.unlinkSync(hbFile()) } catch { /* ignore */ }
  })

  return { started: true, pid: child.pid, reason: '已起一轮（输出在 run.log）' }
}