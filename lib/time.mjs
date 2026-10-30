/**
 * lib/time.mjs —— 本地日期 / 时段判断
 *
 * 只做三件事：今天几号、现在是不是「谷时」、下一次该几点跑。
 * 谷时口径照刷 B 站 / 刷贴吧那套：工作日 9-12、14-18 是忙时，其余算谷时。
 */
export function localToday(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${localToday(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 周末整天算谷时；工作日只有 9-12 / 14-18 算忙时 */
export function isValley(d = new Date(), cfg = {}) {
  const day = d.getDay()
  const h = d.getHours()
  if (day === 0 || day === 6) {
    if (day === 0) return cfg.sunday !== false
    return cfg.saturday !== false
  }
  if (h >= 9 && h < 12) return cfg.noonBusy === false
  if (h >= 14 && h < 18) return cfg.afternoonBusy === false
  return true
}

/** 下一个谷时起点（只用于「下一轮什么时候」的展示） */
export function nextValley(d = new Date(), cfg = {}) {
  const t = new Date(d.getTime())
  for (let i = 0; i < 48 * 60; i += 15) {
    if (isValley(t, cfg)) return new Date(t.getTime())
    t.setMinutes(t.getMinutes() + 15)
  }
  return null
}

export function fmtWhen(d) {
  if (!d) return ''
  return `${localToday(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}