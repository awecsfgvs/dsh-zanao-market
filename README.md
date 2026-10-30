# dsh-zanao-market

DSH 插件 · **刷赞噢校园集市**。照 `dsh-tieba-scroll`（刷贴吧）/ `dsh-bili-scroll`（刷 B 站）的骨架做的一套：

- 每天替你翻几页集市（列表只保留约 96 小时，所以要高频看）；
- 读完挑重点，写一份 **Markdown 日报**；
- 回帖 **默认只落草稿**，人扫一眼再放行；自动回帖默认关，开了也有三道硬闸；
- 支持谷时定时跑（`autoRun`，默认关）。

接口走 **Web 端** `https://c.zanao.com/sc-api/`：没有全局签名，带 `user_token` 就能读写，
所以不需要逆小程序的 `X-Sc-Ah`，也不需要 App 端 `libAes.so` 里的 secret。

## 装

```bash
# 本地开发 / 直接装目录
dsh plugin --profile desktop add link:D:/DSH工作区1/dsh-zanao-market
# 或者打包后装
npm pack && dsh plugin --profile desktop add ./dsh-zanao-market-0.1.0.tgz
```

装完重启 DSH（插件在启动时注册工具与定时器）。

## 首次配置

1. **拿 token**：微信里打开集市任意帖子 → 抓包（iPhone 用 Stream / 安卓用 HTTP Canary）→
   找 `c.zanao.com` 且路径带 `/sc-api/` 的请求 → 复制 `user_token` 的值；
   电脑上也可用微信开发者工具打开小程序，在 Network 里找。
2. `zanao_login`（或设置页粘贴）→ 自动 probe：学校、列表、本人信息三步全绿才算好。
3. `zanao_config` 调参数（可选）：`keywords`、`readPerRound`、`replyPerDay`、`runHour`…

## 工具

| 工具 | 干什么 |
| --- | --- |
| `zanao_status` | 登录 / 今日额度 / 草稿数 / 上一轮 / 下次窗口（排障第一步） |
| `zanao_config` | 读或改配置（`patch` 对象） |
| `zanao_login` | 存 `user_token` 并验证（只写本地，不回显） |
| `zanao_whoami` | 看登录的是谁 |
| `zanao_list` | 列表（热度/最新），标出读过的 |
| `zanao_thread` | 正文 + 评论（默认前 10 条），读完标已读 |
| `zanao_draft` | **默认出口**：把要回的话落草稿 |
| `zanao_drafts` | 草稿箱 |
| `zanao_reply` | 真发一条（`confirm` + `autoReply`/`force` + `draftOnly`/`approved`） |
| `zanao_report_write` / `_read` / `_reports` | 日报 |
| `zanao_persona` | 人设与语气样本 |
| `zanao_selfcheck` | 一次跑完只读自检 |
| `zanao_run` | 立刻跑一轮（headless 子进程，输出在 `run.log`） |

## 回帖的三道闸 + 两道锁

- **闸 1** 每天 `replyPerDay` 条（默认 5）；
- **闸 2** 两条之间至少 `replyGapSec` 秒（默认 60）；
- **闸 3** 同一个帖一天只回一次；
- **锁 1** `autoReply` 默认关，关着时 `zanao_reply` 直接拒（除非用户当场 `force:true`）；
- **锁 2** `draftOnly` 默认开，必须「先落草稿 → 人看过 → `approved:true`」才发。

额度计数在 `$DSH_HOME/zanao-market/state.json`，跨进程、重启都认。

## 数据放在哪

```
$DSH_HOME/zanao-market/
  token.txt      # user_token（600，不回显、不进配置、不进日志）
  config.json    # 设置（600）
  state.json     # 今日条数 / 读过的帖 / 上一轮
  drafts.jsonl   # 回帖草稿
  reports/       # 日报 YYYY-MM-DD.md
  run.log        # headless 一轮的全部输出
  round.lock     # 跨进程锁
```

## 自动跑的前提

`autoRun` 到点后会起 `dsh --profile headless "<prompts/duty.md>"`。
所以机器上得有**独立 CLI**（`npm i -g @deepseek-ai/dsh`），或者把 `dshBin` 指到一个能跑的绝对路径。
`zanao_status` 里的 `headless` 字段会告诉你现在找不找得到它。

## 已知边界

- 列表接口只回约 **96 小时**内的帖（约 650 条），翻不过去；要更早的只能靠关键词搜索。
- 读评论必须先用 `thread/info` 拿 `t_sign`，插件里已封装（`zanao_thread`）。
- token 过期报 `errno 20`，重抓一次即可。
- 工具只碰**本人账号**：`user/info` 固定 `from=mine`，不查别人。

## 测试

```bash
node test/smoke.mjs            # 会真连集市，只读 + 落草稿，不发任何内容
```

## License

MIT