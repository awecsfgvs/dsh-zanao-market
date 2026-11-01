# Changelog

## 0.1.8 — 2026-11-01

- 点赞范围收窄：默认只点「自己发言过的那个帖子」。
  `likeOwnComment` / `likeOwnThread` 默认改成 `false` —— 不再点自己的评论、不再点自己发的帖。
  `autoLike` 与 `likeRepliedThread` 保持 `true`。代码路径都在，开关打开即可恢复。

## 0.1.7 — 2026-10-31

- 新增点赞：`POST thread/like`（`id`+`comment_id=0`+`action=1`）与 `POST comment/like`（`id`+`comment_id`+`action=1`）。
  `action=0` 取消。服务端幂等置位，重复点不累加 —— `lib/zanao.mjs` 实测：点前 `like_num=0 / like_has=false`，点后 `1 / true`。
- `lib/zanao.mjs` 加 `likeThread()`、`likeComment()`、`myCommentId()`（发评论接口不回 id，只能回头按 `is_mine` + 内容找）；
  `comments()` 映射补 `mine` / `likeHas`。
- `bin/water.mjs`：回帖后顺手点「自己发言的这个帖子」+「自己刚发的那条评论」。
- 新增 `bin/like.mjs`：补赞脚本，把 `state.replied` 里回过言的帖 + 列表里自己的帖点一遍，一轮 25 个封顶。
- 新增工具 `zanao_like`（默认干跑，`confirm:true` 才点，`action:0` 取消）。
- 配置新增 `autoLike` / `likeRepliedThread` / `likeOwnComment` / `likeOwnThread`（默认全开）；设置页回帖卡片加了四个开关。
- `state.json` 加 `liked` / `likedComments` 记录，省重复请求。

## 0.1.6 — 2026-10-31

- 新增 `replyGapJitterSec`：两条间隔在 `replyGapSec ~ replyGapSec + replyGapJitterSec` 之间随机浮动。
  浮动值用 `lastReplyAt` 当种子（mulberry32），同一条回复之后算出来的间隔固定，`waitSec` 不会来回抖。
  `lib/state.mjs` 新增 `gapSeconds()`，`replyQuota()` 多返回一个 `gapSec`；`water.log` 里跳过的那行会打印本轮间隔。
- `replyPerDay` 上限从 500 放宽到 2000（原来填 800 会被夹回 500）。
- 设置页回帖卡片多一个「间隔随机浮动上限（0=固定）」输入框。
- 实测（60 + 120）：10:44:03 → 10:46:03 各发一条，10:45 / 10:47 / 10:48 按间隔跳过，日志打印 99s / 128s。

## 0.1.5 — 2026-10-30

- `bin/water.mjs` 加互斥锁 `water.lock`（O_EXCL 建文件，2 分钟过期）：cron 与手动同时触发时只发一条。
  之前 14:56:01 手动 + 14:56:03 cron 撞车，同一帖发了两条「+3」「3」。
- 落盘前重读 state，避免覆盖别处刚写的计数。
- `replyPerDay` 上限从 50 放宽到 500（不设实质上限，有新帖就发）。

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