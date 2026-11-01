/**
 * dsh-zanao-market —— 浏览器半端（设置里的「刷赞噢集市」）
 *
 * 只做三件事：看状态、存 token、调开关。所有写操作都落到主机的
 * /api/zanao-market，真正干活（跑一轮、回帖）仍然在工具层。
 *
 * 太长的东西（自检 JSON、日志）折叠，不撑开设置页。
 */
window.__ModuleLoader__.load({
  id: 'dsh-zanao-market',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/zanao-market'
    const parse = async (r) => {
      const t = await r.text()
      try { return JSON.parse(t) } catch { throw new Error(`接口返回的不是 JSON（HTTP ${r.status}）：${t.slice(0, 120)}`) }
    }
    const jget = async (p) => parse(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => parse(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
      .zn { padding: 14px 16px 28px; max-width: 700px; font-size: 14px; color: #22303f; }
      .zn-h { font-size: 16px; font-weight: 700; margin: 0 0 3px; }
      .zn-sub { color: #7a8ba6; font-size: 12.5px; line-height: 1.6; margin-bottom: 12px; }
      .zn-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      .zn-chip { background: #f1f6fd; color: #40597f; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
      .zn-chip.ok { background: #e8f7ee; color: #178a4c; }
      .zn-chip.warn { background: #fff6e5; color: #8a6414; }
      .zn-chip.bad { background: #fdecea; color: #b03a2e; }
      .zn-card { border: 1px solid #e2eaf5; border-radius: 12px; background: #fff; padding: 12px 14px; margin-bottom: 12px; }
      .zn-card > summary { cursor: pointer; font-weight: 600; list-style: none; }
      .zn-card > summary::-webkit-details-marker { display: none; }
      .zn-card > summary::before { content: '▸ '; color: #8fa8cc; }
      .zn-card[open] > summary::before { content: '▾ '; }
      .zn-tag { color: #8fa8cc; font-weight: 400; font-size: 12px; margin-left: 6px; }
      .zn-body { margin-top: 10px; }
      .zn-label { font-weight: 600; font-size: 13px; margin: 10px 0 6px; display: block; }
      .zn-in, .zn-ta { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d3dce8;
        border-radius: 8px; font-size: 13px; font-family: inherit; background: #fff; color: #22303f; }
      .zn-ta { min-height: 64px; resize: vertical; }
      .zn-num { width: 82px; padding: 7px 8px; border: 1px solid #d3dce8; border-radius: 8px; font-size: 13px; text-align: center; }
      .zn-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
      .zn-kv { color: #54657c; font-size: 12.5px; line-height: 1.8; }
      .zn-btn { border: 0; border-radius: 8px; padding: 8px 13px; font-size: 13px; cursor: pointer; background: #2d6cdf; color: #fff; }
      .zn-btn:disabled { opacity: .55; cursor: default; }
      .zn-btn.ghost { background: #eef3fb; color: #2d6cdf; }
      .zn-btn.sm { padding: 5px 10px; font-size: 12px; }
      .zn-msg { margin-top: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
      .zn-msg.ok { color: #178a4c; } .zn-msg.err { color: #c0392b; }
      .zn-sw { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
      .zn-pre { white-space: pre-wrap; max-height: 220px; overflow: auto; margin-top: 8px;
        background: #f7faff; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      .zn-loading { display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 12px; min-height: 200px; color: #6b86a8; font-size: 13px; }
      .zn-spin { width: 26px; height: 26px; border-radius: 50%; border: 3px solid #dbe7f7;
        border-top-color: #2d6cdf; animation: zn-spin .8s linear infinite; }
      @keyframes zn-spin { to { transform: rotate(360deg); } }
    `

    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err } }
      render() {
        if (this.state.err) {
          return h('div', { className: 'zn' }, [
            h('div', { key: 't', className: 'zn-h' }, '刷赞噢集市 · 面板出错了'),
            h('div', { key: 'm', className: 'zn-msg err' }, String(this.state.err.message || this.state.err)),
            h('div', { key: 's', className: 'zn-pre' }, String(this.state.err.stack || '').split('\n').slice(0, 6).join('\n')),
          ])
        }
        return this.props.children
      }
    }

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [cfg, setCfg] = React.useState(null)
      const [token, setToken] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [health, setHealth] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const [s, c] = await Promise.all([jget('/status'), jget('/config')])
          setSt(s); setCfg(c)
        } catch (e) { setMsg({ ok: false, text: '读配置失败：' + e.message }) }
      }, [])
      React.useEffect(() => { load() }, [load])

      const save = async (patch) => {
        setBusy(true); setMsg(null)
        try {
          const c = await jpost('/config', patch)
          setCfg(c); await load()
          setMsg({ ok: true, text: '已保存。' })
        } catch (e) { setMsg({ ok: false, text: '保存失败：' + e.message }) } finally { setBusy(false) }
      }
      const saveToken = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/token', { token: token.trim() })
          const ok = !!(r.ok && (r.steps || []).every((x) => x.ok))
          setMsg({ ok, text: ok ? 'token 已验证可用。' : 'token 存下了，但有一步没通：\n' + JSON.stringify(r.steps || r, null, 1) })
          setToken(''); await load()
        } catch (e) { setMsg({ ok: false, text: '保存失败：' + e.message }) } finally { setBusy(false) }
      }
      const check = async () => {
        setBusy(true); setMsg(null)
        try { const r = await jget('/selfcheck'); setHealth(r); await load() }
        catch (e) { setMsg({ ok: false, text: '自检失败：' + e.message }) } finally { setBusy(false) }
      }
      const run = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/run', {})
          setMsg({ ok: !!r.ok, text: r.ok ? '已起一轮（输出在 run.log）。' : (r.reason || '没起来') })
          await load()
        } catch (e) { setMsg({ ok: false, text: '起不来：' + e.message }) } finally { setBusy(false) }
      }

      if (!st || !cfg) {
        return h('div', { className: 'zn' }, h('div', { className: 'zn-loading' }, [
          h('div', { key: 's', className: 'zn-spin' }), h('div', { key: 't' }, '读配置中…'),
        ]))
      }

      const chip = (cls, text) => h('span', { key: text, className: 'zn-chip ' + cls }, text)
      const sw = (key, label) => h('label', { key, className: 'zn-sw' }, [
        h('input', {
          key: 'i', type: 'checkbox', checked: !!cfg[key], disabled: busy,
          onChange: (e) => save({ [key]: e.target.checked }),
        }),
        h('span', { key: 'l' }, label),
      ])
      const num = (key, label, hint) => h('div', { key, className: 'zn-row' }, [
        h('span', { key: 'l', className: 'zn-kv', style: { minWidth: 148 } }, label + (hint ? `（${hint}）` : '')),
        h('input', {
          key: 'i', className: 'zn-num', type: 'number', defaultValue: cfg[key], disabled: busy,
          onBlur: (e) => { const v = Number(e.target.value); if (v !== cfg[key]) save({ [key]: v }) },
        }),
      ])

      return h('div', { className: 'zn' }, [
        h('div', { key: 'h', className: 'zn-h' }, '刷赞噢集市'),
        h('div', { key: 's', className: 'zn-sub' },
          '每天翻几页集市、挑重点写日报；回帖默认只落草稿，人看过再发。接口走 Web 端，不需要签名。'),

        h('div', { key: 'c', className: 'zn-chips' }, [
          st.token === '没有' ? chip('bad', '凭证 未配置') : chip('ok', '凭证 ' + st.token),
          chip('', `今日 ${st.today.replies} 条 / 剩 ${st.today.quotaLeft}`),
          chip('', `草稿 ${st.drafts.draft || 0}`),
          chip(st.round.state === 'running' ? 'warn' : '', st.round.state === 'running' ? '正在跑' : '空闲'),
          chip(st.headless.ok ? 'ok' : 'warn', st.headless.ok ? 'headless ✓' : 'headless ✗'),
        ]),

        h('details', { key: 'k1', className: 'zn-card', open: st.token === '没有' }, [
          h('summary', { key: 's' }, ['账号与凭证', h('span', { key: 't', className: 'zn-tag' }, 'user_token 只存本地')]),
          h('div', { key: 'b', className: 'zn-body' }, [
            h('div', { key: 'k', className: 'zn-kv' },
              '抓包取：微信里打开集市任意帖子 → 找 c.zanao.com / sc-api/ 请求 → 复制 user_token 的值。'),
            h('input', {
              key: 'i', className: 'zn-in', type: 'password', value: token, disabled: busy,
              placeholder: '粘 user_token（也接受整条 Cookie）',
              onChange: (e) => setToken(e.target.value),
            }),
            h('div', { key: 'r', className: 'zn-row' }, [
              h('button', { key: 'b1', className: 'zn-btn', disabled: busy || !token.trim(), onClick: saveToken }, '保存并验证'),
              h('button', { key: 'b2', className: 'zn-btn ghost', disabled: busy, onClick: check }, '运行自检'),
              h('span', { key: 'c', className: 'zn-kv' }, '学校 cid：'),
              h('input', {
                key: 'cid', className: 'zn-in', style: { width: 110 }, defaultValue: cfg.cid, disabled: busy,
                onBlur: (e) => { const v = e.target.value.trim(); if (v && v !== cfg.cid) save({ cid: v }) },
              }),
            ]),
            health ? h('pre', { key: 'h', className: 'zn-pre' }, JSON.stringify(health, null, 1)) : null,
          ]),
        ]),

        h('details', { key: 'k2', className: 'zn-card', open: true }, [
          h('summary', { key: 's' }, ['每一轮', h('span', { key: 't', className: 'zn-tag' }, '读多少、多久跑')]),
          h('div', { key: 'b', className: 'zn-body' }, [
            num('readPerRound', '每轮读几个帖'),
            num('dedupeDays', '读过的帖几天内不再推'),
            num('requestGapMs', '两次请求间隔', '毫秒'),
            h('label', { key: 'kw', className: 'zn-label' }, '优先关键词（逗号或换行分隔）'),
            h('textarea', {
              key: 'kwi', className: 'zn-ta', defaultValue: (cfg.keywords || []).join('，'), disabled: busy,
              placeholder: '出，求，考研，外卖',
              onBlur: (e) => {
                const list = e.target.value.split(/[\n,，、]/).map((x) => x.trim()).filter(Boolean)
                if (list.join('|') !== (cfg.keywords || []).join('|')) save({ keywords: list })
              },
            }),
          ]),
        ]),

        h('details', { key: 'k3', className: 'zn-card' }, [
          h('summary', { key: 's' }, ['回帖', h('span', { key: 't', className: 'zn-tag' }, '默认只落草稿')]),
          h('div', { key: 'b', className: 'zn-body' }, [
            sw('draftOnly', '只落草稿（人看过再放行）'),
            sw('autoReply', '允许自动回帖（关着时工具会拒）'),
            num('replyPerDay', '每天最多几条'),
            num('replyGapSec', '两条之间至少多少秒', '秒'),
            num('replyGapJitterSec', '间隔随机浮动上限（0=固定）', '秒'),
            h('label', { key: 'rt', className: 'zn-label' }, '固定回复内容（水经验用，留空=照人设写）'),
            h('input', {
              key: 'rti', className: 'zn-in', defaultValue: cfg.replyText || '', disabled: busy,
              placeholder: '3 或 +3',
              onBlur: (e) => { const v = e.target.value.trim(); if (v !== (cfg.replyText || '')) save({ replyText: v }) },
            }),
            sw('autoLike', '回帖后顺手点赞（总闸）'),
            sw('likeRepliedThread', '点自己发言那个帖子的赞'),
            sw('likeOwnComment', '点自己那条评论的赞'),
            sw('likeOwnThread', '点自己发的帖的赞'),
            h('div', { key: 'n', className: 'zn-kv' }, '同帖一天只回一次，这条写死在 state 里，改不了。'),
          ]),
        ]),

        h('details', { key: 'k4', className: 'zn-card' }, [
          h('summary', { key: 's' }, ['自动化', h('span', { key: 't', className: 'zn-tag' }, '默认关')]),
          h('div', { key: 'b', className: 'zn-body' }, [
            sw('autoRun', '到点自动跑一轮'),
            sw('valleyOnly', '只在谷时跑'),
            num('runHour', '几点之后跑', '0-23'),
            st.headless.ok
              ? h('div', { key: 'hd', className: 'zn-kv' }, `headless：${st.headless.version || '可用'}`)
              : h('div', { key: 'hd', className: 'zn-kv', style: { color: '#b03a2e' } }, 'headless：' + (st.headless.error || '不可用')),
            h('div', { key: 'r', className: 'zn-row' }, [
              h('button', { key: 'r1', className: 'zn-btn', disabled: busy, onClick: run }, '立刻跑一轮'),
              h('button', { key: 'r2', className: 'zn-btn ghost', disabled: busy, onClick: load }, '刷新状态'),
            ]),
            h('div', { key: 'w', className: 'zn-kv' }, '下一窗口：' + (st.nextWindow || '—') + ' · 日志：' + (st.log || '')),
          ]),
        ]),

        msg ? h('div', { key: 'm', className: 'zn-msg ' + (msg.ok ? 'ok' : 'err') }, msg.text) : null,
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-zanao-market')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-zanao-market: 设置页样式')
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'zanao-market', order: 32, label: '刷赞噢集市' },
          () => h(Boundary, null, h(Panel)),
        ))
      },
    }
  },
})