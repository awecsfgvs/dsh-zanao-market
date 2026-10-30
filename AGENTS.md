# AGENTS.md — 给改这个仓库的 agent 看

## 这是什么

DSH 插件：刷赞噢校园集市（读帖 → 日报 → 可选回帖）。骨架照 `dsh-tieba-scroll`。

## 硬约束（改代码前先读）

1. **凭证只有一处**：`$DSH_HOME/zanao-market/token.txt`（600）。
   不许把 token 写进 `config.json`、日志、工具返回值、错误信息 —— 报错里只许出现 `bG1C…WGs9` 这种掩码。
2. **写操作必须双重确认**：`zanao_reply` 要求 `confirm:true`；`autoReply` 关着时还要求 `force:true`；
   `draftOnly` 开着时必须有草稿 + `approved:true`。别为了"顺手"放宽任何一道。
3. **额度是本地硬闸**：每日条数、两条间隔、同帖一天一次，全在 `lib/state.mjs` 算，不靠模型自觉。
4. **只碰本人账号**：`user/info` 固定 `from=mine`。不要加"查别人"的参数。
5. **headless 子进程里不许再起调度器**：`ZANAO_MARKET_NO_SCHEDULE=1` 那条分支别动，否则会子子孙孙一直起。

## 接口要点

- Web 端 `https://c.zanao.com/sc-api/`，请求头 `X-Sc-Alias: <cid>`、`X-Sc-Platform: web`，Cookie `user_token`。
- `errno=0` 成功；`3` 路径不存在；`20` 未登录。
- 列表 `/thread/v2/list` 只回约 96 小时；读评论要先 `POST /thread/info`（multipart/form）拿 `data.t_sign`，
  再 `GET /comment/list?...&sign=<t_sign>`。
- 写：`POST /comment/post`（`id`/`content`/`reply_comment_id`/`root_comment_id`/`use_anon`/`from=detail`）、
  `POST /thread/post`。Web 端**不需要签名**。

## 验证

```bash
node --check index.js
node test/smoke.mjs     # 真连集市：只读 + 落草稿，不发内容
```

冒烟失败先看 `zanao_selfcheck` 的三步（community / list / user），再判断是 token 过期还是接口改版。

## 风格

- 注释写「为什么」，不写「是什么」；中文，短句。
- 新增工具：`zanao_` 前缀，`parameters` 只给必要字段，返回对象（宿主的 output.schema 是 object）。
- 新增配置项同时改三处：`DEFAULTS`、`normalize()`、`README` 的配置段。