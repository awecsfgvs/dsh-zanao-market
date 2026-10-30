# Changelog

## 0.1.0 — 2026-10-30

首个版本。

- 15 个 `zanao_*` 工具：状态 / 配置 / 登录 / 本人 / 列表 / 读帖 / 草稿 / 草稿箱 / 回帖 / 日报 ×3 / 人设 / 自检 / 跑一轮。
- 接 Web 端 `c.zanao.com/sc-api/`（无签名，`user_token` 即可读写）；读评论自动走 `thread/info → t_sign → comment/list`。
- 回帖五道闸：`confirm` + `autoReply`/`force` + `draftOnly`/`approved` + 每日条数 / 间隔 / 同帖一天一次。
- 默认只落草稿（`draftOnly: true`），模型不直接对外说话。
- headless 跑一轮：跨进程锁 + 心跳 + 25 分钟超时 + `ZANAO_MARKET_NO_SCHEDULE` 防递归。
- 谷时定时（`autoRun` 默认关）、日报 `reports/YYYY-MM-DD.md`、草稿箱 `drafts.jsonl`。
- `test/smoke.mjs` 真机只读冒烟；`test/gates.mjs` 离线闸门测试（CI 用）。