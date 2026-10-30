/**
 * lib/config.mjs —— 插件自己的配置（不依赖宿主的 schemastery 表单）
 *
 * 位置：$DSH_HOME/zanao-market/config.json（600）。宿主传进来的 config 只当默认值。
 * ⚠️ user_token **不在**这里：它在同目录 token.txt，单独 600，
 *    这样备份/分享 config.json、或者设置页回显配置，都不会把钥匙带出去。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './zanao.mjs'

export const configFile = () => path.join(homeDir(), 'config.json')

export const DEFAULTS = {
  cid: 'ncwu',            // 学校别名：华水站 = ncwu
  keywords: [],           // 想优先看到的词（求购/出/考研/外卖…）
  readPerRound: 6,        // 一轮最多读几个帖子
  dedupeDays: 7,          // 读过的帖，多少天内不再推
  requestGapMs: 1500,     // 两次请求间隔（越小越快，越容易被风控）
  ignoreMine: true,       // 自己发的帖不进推荐
  // 回帖：默认「只落草稿」，人看过再发
  autoReply: false,
  draftOnly: true,
  replyPerRound: 1,
  replyPerDay: 5,
  replyGapSec: 60,
  replyText: '',          // 非空时回帖只发这句（水经验用，例如 "3" / "+3"）
  replyTexts: [],         // 话术池（水经验用）；非空时每轮从里面随机挑一句，优先于 replyText
  // 自动跑
  autoRun: false,
  runHour: 21,
  valleyOnly: true,
  noon: true,
  night: true,
  headlessProfile: 'headless',
  dshBin: '',
  // 人设
  personaText: '',
  personaFile: '',
  styleSamples: '',
  // 日报
  reportEnabled: true,
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

export function normalize(raw = {}) {
  const kw = Array.isArray(raw.keywords)
    ? raw.keywords
    : String(raw.keywords || '').split(/[\n,，、]/)
  return {
    cid: (String(raw.cid || DEFAULTS.cid).trim().toLowerCase() || DEFAULTS.cid).slice(0, 32),
    keywords: kw.map((s) => String(s).trim()).filter(Boolean).slice(0, 50),
    readPerRound: clampInt(raw.readPerRound, 1, 30, DEFAULTS.readPerRound),
    dedupeDays: clampInt(raw.dedupeDays, 1, 60, DEFAULTS.dedupeDays),
    requestGapMs: clampInt(raw.requestGapMs, 300, 8000, DEFAULTS.requestGapMs),
    ignoreMine: raw.ignoreMine !== false,
    autoReply: raw.autoReply === true,
    draftOnly: raw.draftOnly !== false,
    replyPerRound: clampInt(raw.replyPerRound, 1, 10, DEFAULTS.replyPerRound),
    replyPerDay: clampInt(raw.replyPerDay, 0, 500, DEFAULTS.replyPerDay),
    replyGapSec: clampInt(raw.replyGapSec, 10, 3600, DEFAULTS.replyGapSec),
    replyText: String(raw.replyText || '').slice(0, 120),
    replyTexts: Array.isArray(raw.replyTexts)
      ? raw.replyTexts.map((x) => String(x).trim()).filter(Boolean).slice(0, 30).map((x) => x.slice(0, 40))
      : DEFAULTS.replyTexts,
    autoRun: raw.autoRun === true,
    runHour: clampInt(raw.runHour, 0, 23, DEFAULTS.runHour),
    valleyOnly: raw.valleyOnly !== false,
    noon: raw.noon !== false,
    night: raw.night !== false,
    headlessProfile: String(raw.headlessProfile || DEFAULTS.headlessProfile).slice(0, 40),
    dshBin: String(raw.dshBin || '').slice(0, 500),
    personaText: String(raw.personaText || '').slice(0, 20000),
    personaFile: String(raw.personaFile || '').slice(0, 500),
    styleSamples: String(raw.styleSamples || '').slice(0, 4000),
    reportEnabled: raw.reportEnabled !== false,
  }
}

export function readConfig(hostConfig = {}) {
  let disk = {}
  try { disk = JSON.parse(fs.readFileSync(configFile(), 'utf8')) } catch { /* 还没有 */ }
  return normalize({ ...DEFAULTS, ...hostConfig, ...disk })
}

export function writeConfig(patch = {}, hostConfig = {}) {
  const cur = readConfig(hostConfig)
  const next = normalize({ ...cur, ...patch })
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  try { fs.chmodSync(configFile(), 0o600) } catch { /* ignore */ }
  return next
}