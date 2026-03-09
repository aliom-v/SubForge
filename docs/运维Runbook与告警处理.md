# SubForge 运维 Runbook 与告警处理

## 1. 文档目的

本文档只保留运维视角的内容，重点说明：

- 当前服务由哪些运行组件组成
- 发版前后应该检查什么
- 值班时先看哪些信号
- 告警应该优先盯哪些事件
- 发生故障后建议按什么顺序响应

如果你在排查具体症状，例如 `Unexpected token '<'`、`401`、`429`、缓存命中异常或订阅返回旧数据，请优先看 `docs/排障与常见问题.md`。

## 2. 当前运行面

当前线上 / 本地运行面可以概括为：

- Worker HTTP API
- Worker 静态资源回退（`ASSETS`）
- D1 主数据库（`DB`）
- KV 缓存（`SUB_CACHE`）
- Cron 规则源同步

对应关键配置：

- `ADMIN_JWT_SECRET`
- `ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC`
- `ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`
- `SUBSCRIPTION_CACHE_TTL`
- `SUBSCRIPTION_RATE_LIMIT_WINDOW_SEC`
- `SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS`
- `PREVIEW_CACHE_TTL`
- `SYNC_HTTP_TIMEOUT_MS`
- `APP_ENV`

## 3. 日常巡检建议

### 3.1 每次发版前

如果你希望本地直接镜像当前 GitHub Actions 校验链路，优先执行：

```bash
npm run ci:verify
```

这条命令会依次覆盖：

- `npm run test:contract`
- `npm run test:smoke`
- `npm run test:unit`
- `npm run typecheck`
- `npm run build`
- `npm run build:worker`

如果当前环境还没装好依赖，至少先执行：

```bash
npm run test:smoke
```

如果本次属于正式发版，请继续对照第 8 节的分环境发布 / 回滚 checklist。

### 3.2 每次部署后

建议最少验证以下 5 点：

1. `GET /health` 返回 `200`
2. 后台页面能正常打开
3. `GET /api/setup/status` 能返回 JSON
4. 管理员能登录并进入后台
5. 任意一个公开订阅 token 能返回订阅原文

如果涉及 `staging -> production` 提升或需要紧急回滚，继续看第 8 节。

### 3.3 每日 / 例行观察项

建议关注：

- `/health` 是否持续正常
- 最近同步日志是否持续成功
- 最近审计日志是否出现异常高频操作
- 登录 `429` 与公开订阅 `429` 是否异常激增
- 规则源是否长期停留在 `failed`
- 规则数是否突然大幅下降或归零

## 4. 关键检查命令

本地基础检查：

```bash
npm run test:smoke
npm run dev:worker
npm run dev:web
```

部署相关：

```bash
npm run ci:verify
npm run deploy
```

如果你需要拆开排查，也可以再单独执行 `npm run build`、`npm run db:migrations:apply` 与 `npm run deploy:worker`。

基础接口探测：

```bash
curl -i http://127.0.0.1:8787/health
curl -i http://127.0.0.1:8787/api/setup/status
curl -i http://127.0.0.1:8787/s/<token>/mihomo
```

## 5. 值班快速分诊

下面只保留“先看什么”的分诊入口，详细症状排查统一指向 FAQ，避免和 `docs/排障与常见问题.md` 重复展开。

| 现象 | 首先看什么 | 详细文档 |
| --- | --- | --- |
| `/health` 非 `200` | 最近部署、D1 / KV 绑定、环境变量、Worker 是否为最新版本 | `docs/部署指南.md` |
| `/api/*` 返回 HTML 或出现 `Unexpected token '<'` | `run_worker_first = true`、响应 `content-type`、静态资源回退是否误命中 | `docs/排障与常见问题.md` |
| 后台登录异常（`401` / `429`） | `ADMIN_JWT_SECRET`、管理员记录、`retry-after`、`x-subforge-rate-limit-remaining` | `docs/排障与常见问题.md` |
| 公开订阅异常（`404` / `429` / 旧数据） | `x-subforge-cache-key`、`x-subforge-rate-limit-reset`、用户 / 模板 / 节点状态 | `docs/排障与常见问题.md` |
| 规则源同步持续失败 | `sync_logs.details_json`、`errorCode`、`upstreamStatus`、最近成功快照 | `docs/排障与常见问题.md` |

## 6. 告警建议

当前仓库已经提供一层**基础失败告警**：`.github/workflows/failure-alert.yml` 会在 `CI`、`Deploy` 或 `D1 Backup` 失败时生成 GitHub Actions failure summary；如果配置 `FAILURE_WEBHOOK_URL`，还会把失败信息发到外部 webhook。

在此基础上，如果还要接入 Slack / Telegram / 邮件 / OpenClaw 等外部平台，建议优先监控这些信号：

### 6.1 高优先级告警

- `/health` 连续失败
- 登录 `429` 明显激增
- 公开订阅 `429` 明显激增
- 规则源连续多次同步失败
- 规则数突然降为 `0`
- 预览或公开订阅连续出现 `4xx` / `5xx` 异常峰值

### 6.2 中优先级告警

- 审计日志出现异常高频 token 重置
- 审计日志出现异常高频缓存重建
- 某个规则源长期 `skipped`，但业务侧确认上游其实已变化
- D1 / KV 绑定缺失导致功能部分失效

### 6.3 低优先级提示

- 订阅缓存命中率持续偏低
- 规则源同步耗时持续增长
- 单个 token 的请求频率明显高于平时

## 7. 建议的响应流程

### 7.1 服务不可用

建议顺序：

1. 先看 `/health`
2. 再看 Cloudflare 最近一次部署是否成功
3. 再看 D1 / KV 绑定是否存在
4. 再看 Worker 版本是否为最新部署
5. 再回查 `ci:verify` 与 deploy 是否在发布前成功，必要时拆看 contract / smoke / build / migration

### 7.2 数据不正确

建议顺序：

1. 先确认是不是缓存问题
2. 再确认用户、节点、模板、规则源当前数据
3. 再看最近同步日志与审计日志
4. 最后再检查编译链路与模板内容

### 7.3 安全或滥用问题

建议顺序：

1. 确认是否触发登录 / 订阅频控
2. 必要时重置泄漏用户的 token
3. 必要时临时收紧频控阈值
4. 如果后台暴露风险较高，优先考虑 Cloudflare Access / Zero Trust / WAF 规则

## 8. 发布与回滚流程

- **发布前准备**
  - 在待发布 commit 上执行 `npm run ci:verify`；如需额外确认预发布配置，可补执行 `npm run build:worker:staging`
  - 如涉及 D1 migration、批量导入、手工 SQL 或人工修数，先按第 9 节导出 D1 备份
  - 确认 GitHub Secrets / Cloudflare 绑定齐全：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_JWT_SECRET`，以及目标环境对应的 D1 / KV；如接了外部通知，再确认 `FAILURE_WEBHOOK_URL`
  - 准备好验收样本：`/health`、`/api/setup/status`、管理员账号、可用订阅 token、至少一个可手动同步的规则源或远程节点源

- **staging 发布**
  - 常规路径：合入 `release/*` 分支，等待 Deploy workflow 自动执行 `npm run deploy:staging`
  - 补发或重放：手动触发 `.github/workflows/deploy.yml`，选择 `target_environment=staging`，并显式填写待发布的 `git_ref`
  - 发布完成后，至少执行第 3.2 节的 5 项验收，并补看一次同步日志 / 审计日志

- **production 发布**
  - 只提升已经在 `staging` 验收通过的 commit；高风险变更建议从 `main` 分支上下文手动触发 `workflow_dispatch`
  - 当前 workflow 只允许从 `main` 上下文发起 production 手动发布；建议同时启用 GitHub `production` environment 审批
  - 发布后除了第 3.2 节的 5 项验收，还要确认 failure summary / webhook 没有继续报错

- **回滚触发条件**
  - `GET /health` 持续失败，或 `/api/*` 返回 HTML / `Unexpected token '<'`
  - 管理员登录异常、公开订阅大面积失效、规则 / 节点同步普遍失败
  - 发布后出现明显数据错乱、D1 migration 不符合预期，或 failure alert 持续触发

- **回滚操作**
  - `代码回滚`：优先使用 Deploy workflow 的 `workflow_dispatch`，把 `target_environment` 指向目标环境、`git_ref` 指向上一个稳定 SHA / tag / 分支；本地执行时，对应使用 `npm run deploy` 或 `npm run deploy:staging`
  - `数据回滚`：当前仓库没有自动化 D1 down migration / 数据恢复脚本；如 schema 或数据已损坏，需要依赖 Cloudflare Dashboard 或既有数据库快照 / 备份流程恢复后，再重新部署上一个稳定版本
  - `回滚后验收`：重新执行第 3.2 节检查项，并记录失败 workflow URL、影响范围、开始 / 恢复时间与后续修复动作


## 9. D1 数据备份与恢复

这部分只保留值班视角的最小决策与检查表；完整命令解释、恢复边界和 Cloudflare 操作顺序统一以 `docs/部署指南.md` 第 3.2 节为准。

- **何时必须备份**
  - 执行 production migration 前
  - 批量导入节点、手工 SQL 修数或高风险后台操作前
  - 准备做数据回滚前，先保留当前故障现场

- **最常用命令**

```bash
npm run backup:d1
npm run backup:d1:staging
D1_BACKUP_ARCHIVE_PASSPHRASE=your-passphrase npm run backup:d1:encrypted
D1_BACKUP_ARCHIVE_PASSPHRASE=your-passphrase npm run backup:d1:decrypt -- --input ./backups/d1/<backup.sql.enc>
npm run d1:restore:drill -- --file ./backups/d1/<backup.sql>
npx wrangler d1 execute DB --remote --config ./wrangler.toml --file "./backups/d1/subforge-production-YYYYMMDD-HHMMSS.sql" -y
```

- **workflow / 归档约束**
  - 仓库已提供 `.github/workflows/d1-backup.yml`，每天 `03:15 UTC` 自动执行 production full backup
  - 如已配置 `D1_BACKUP_ARCHIVE_PASSPHRASE`，artifact 默认保留 `.enc` 与 `.sha256`
  - 如配置 `D1_BACKUP_ARCHIVE_S3_URI`，workflow 会继续执行类似 `aws s3 cp ...` 的对象存储同步；`D1_BACKUP_ARCHIVE_ENDPOINT_URL` 可用于 R2 / MinIO
  - 明文 SQL 归档时必须配置 `D1_BACKUP_ARCHIVE_SSE`；如使用 `aws:kms`，还要补 `D1_BACKUP_ARCHIVE_KMS_KEY_ID`
  - bucket lifecycle / prefix 清理策略需要在对象存储侧配置，生产备份仍建议异地加密保存

- **恢复判断**
  - full export 同时包含 schema + data，只能导回空库 / 新库
  - data-only 备份才适合在已建好相同 schema 的库上回灌
  - 当前仓库没有自动化 D1 down migration；若 schema 已损坏，仍需要依赖 Cloudflare Dashboard 和备份恢复完成回退

- **建议补做的月度演练**
  - 手动触发一次 `.github/workflows/d1-backup.yml`，建议优先用 `target_environment=staging`、`backup_scope=full`
  - 下载该次 artifact 到本地，并执行 `npm run d1:restore:drill -- --file ./backups/d1/<backup.sql>`；如为加密 artifact，则改为 `D1_BACKUP_ARCHIVE_PASSPHRASE=your-passphrase npm run d1:restore:drill -- --file ./backups/d1/<backup.sql.enc>`
  - 演练完成后，至少抽查 `users`、`nodes`、`templates`、`rule_sources` 四张核心表和一条最近的 `audit_logs`
  - 把本次 workflow run URL、artifact 名称、演练时间和结果记录到值班日志或发布记录中

## 10. 文档边界

- 这份文档只保留巡检、告警、发布 / 回滚与恢复演练决策
- 具体部署步骤、GitHub Actions 输入项、备份 / 恢复 SOP 细节统一放到 `docs/部署指南.md`
- 具体症状排查统一放到 `docs/排障与常见问题.md`

## 11. 相关文档

- `docs/部署指南.md`
- `docs/限流与安全策略.md`
- `docs/API错误码与响应头说明.md`
- `docs/排障与常见问题.md`
