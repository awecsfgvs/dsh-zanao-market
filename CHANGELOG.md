# Changelog

## 0.1.4 — 2026-10-30

- 新增 `replyTexts` 话术池（水经验）：非空时每轮随机挑一句，避开上一句；优先于 `replyText`。
- 默认池：`3 / +3 / 3333333 / 顶顶顶 / 顶 / +1 / 水一下 / 帮顶`。

## 0.1.3 — 2026-10-30

- 新增 `bin/water.mjs`（`zanao-water`）：水经验专用，挑一个没回过的帖子发 `replyText`（3 / +3 交替），
  **不走模型**，复用额度 / 间隔 / 同帖三道闸；额度用完或间隔没到就安静退出。
- 配合 DSH cron 每 8 分钟跑一次即可（`cron` 任务「刷赞噢集市·水经验」）。

## 0.1.2 — 2026-10-30

- 新增 `replyText`：非空时回帖只发这一句（水经验用，例如 `3` / `+3`），duty 与设置页同步。
- 设置页「回帖」卡增加该输入框；留空则回到按人设写。

## 0.1.1 — 2026-10-30

- **设置页**：`设置 → 刷赞噢集市` 面板（`client.js`）+ 主机路由 `/api/zanao-market`
  （`/status`、`/config`、`/token`、`/selfcheck`、`/run`，只接受同源）。
- 面板里能存 token、跑自检、调每轮/回帖/自动化三组开关、立刻跑一轮。
- 路由挂载带三层兜底：`ctx.inject` → 现在取 → 每秒轮询等 `webServer` 就绪。
- `gates.mjs` 增补路由断言（挂载 / status 200 / 未知路径 404）。

## 0.1.0 — 2026-10-30

首个版本。

- 15 个 `zanao_*` 工具：状态 / 配置 / 登录 / 本人 / 列表 / 读帖 / 草稿 / 草稿箱 / 回帖 / 日报 ×3 / 人设 / 自检 / 跑一轮。
- 接 Web 端 `c.zanao.com/sc-api/`（无签名，`user_token` 即可读写）；读评论自动走 `thread/info → t_sign → comment/list`。
- 回帖五道闸：`confirm` + `autoReply`/`force` + `draftOnly`/`approved` + 每日条数 / 间隔 / 同帖一天一次。
- 默认只落草稿（`draftOnly: true`），模型不直接对外说话。
- headless 跑一轮：跨进程锁 + 心跳 + 25 分钟超时 + `ZANAO_MARKET_NO_SCHEDULE` 防递归。
- 谷时定时（`autoRun` 默认关）、日报 `reports/YYYY-MM-DD.md`、草稿箱 `drafts.jsonl`。
- `test/smoke.mjs` 真机只读冒烟；`test/gates.mjs` 离线闸门测试（CI 用）。