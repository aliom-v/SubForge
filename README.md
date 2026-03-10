# SubForge

> 发布到公开 GitHub / GitLab 后，可把下面按钮里的 `https://github.com/aliom-v/SubForge` 替换成真实仓库地址：
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Faliom-v%2FSubForge)

SubForge 是一个部署在 Cloudflare 上的订阅分发与规则同步平台，当前仓库已具备可继续迭代的 MVP 基础：

- React + Vite 管理后台（可打包进 Worker 静态资源）
- Cloudflare Worker API
- D1 持久化用户 / 节点 / 模板 / 规则源 / 日志
- KV 订阅缓存与预览缓存
- 手动 / Cron 规则源同步
- 公开订阅与后台预览
- 审计日志与同步日志

## 目录结构

```text
apps/
  web/         管理后台
  worker/      API / 订阅输出 / Cron
packages/
  core/        订阅编译核心
  shared/      共享类型 / 错误码 / cache key
migrations/    D1 migration
docs/          实施、部署与安全文档
scripts/       初始化脚本
```

## 当前已实现

### 后端

- 首次安装状态检查与初始化管理员 API
- 管理员登录、会话校验、退出接口（支持服务端会话撤销）
- 管理员登录失败限流与公开订阅频控
- 用户 CRUD（含 token 重置 / 节点绑定）
- 节点 CRUD、JSON 批量导入、分享链接 / 订阅 URL 预览导入与远程节点源手动同步
- 模板创建 / 更新 / 删除 / 默认模板切换
- 规则源创建 / 更新 / 删除 / 启停 / 手动同步
- 用户与节点绑定管理
- `/api/preview/:userId/:target` 预览接口
- `/s/:token/:target` 公开订阅接口
- 同步日志与审计日志接口
- 审计日志联表管理员名称、资源展示名，并附带请求方法 / 路径 / Ray / IP 等上下文
- Cron 自动同步启用规则源

### 前端

- 首次安装向导（创建首个管理员）
- 单页式管理后台
- 后台前端可随 Worker 一起部署在同一域名下
- 用户 / 节点 / 模板 / 规则源：创建 + 编辑 + 删除操作
- 节点页支持 JSON 批量导入、分享链接 / 订阅 URL 预览导入与远程节点源同步
- 用户节点绑定界面
- 规则源同步结果展示
- 概览页支持手动重建订阅 / 预览缓存
- 同步日志与审计日志查看
- 订阅预览页面

### 同步与缓存

- 规则源支持 `text` / `yaml` / `json` 三种轻量解析，额外覆盖 yaml 列表 / 块文本、json 多行字符串与常见对象规则
- 远程节点源支持手动拉取同步，并按协议 / 地址 / 端口 / 凭证做导入去重
- 同步时会记录结构化 details：格式、阶段、错误码、耗时、上游状态、规则数、提取 / 重复 / 忽略统计、哈希、跳过原因，以及处理建议 / 可重试标记 / 内容预览
- 同步时会做规则归一化、去重、内容哈希比较
- 内容未变化时会跳过快照更新
- 用户更新 / 绑定变更时按用户失效缓存
- 节点更新 / 删除时按受影响用户失效缓存
- 模板变更时按实际受影响的目标类型失效缓存
- 预览缓存与公开订阅缓存分离，TTL 可独立配置
- 支持后台手动清理全部用户缓存，下次访问按最新数据自动重建
- API 输入增加 URL / 日期 / 端口 / 枚举值校验，前端表单同步做基础校验

## 快速开始

1. 安装依赖：`npm ci`
2. 执行一键初始化：`npm run init:local`
3. 启动 Worker：`npm run dev:worker`
4. 启动 Web：`npm run dev:web`
5. 打开后台，完成首次安装向导或使用已导入的管理员登录

默认本地地址：

- Worker：`http://127.0.0.1:8787`
- Web：`http://127.0.0.1:5173`

本地开发时，Vite 会把 `/api`、`/s`、`/health` 自动代理到 Worker，因此默认可直接走同域请求。

如需显式覆盖前端 API 地址，可设置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
```

更完整的本地与 Cloudflare 部署步骤请看 `docs/部署指南.md`。

如需在初始化时一并导入管理员和 demo 数据，可执行：

```bash
npm run init:local -- --admin-user admin --admin-password your-password --with-demo
```

如果你更想按旧方式手动执行 migration，也可以继续使用：

```bash
npx wrangler d1 migrations apply DB --local --config ./wrangler.toml
```

安装依赖后，如需补一轮更真实的核心回归校验，可执行：

```bash
npm run test:unit
```

## 初始化管理员

优先推荐直接打开后台完成首次安装向导。

如果想把 migration、管理员导入和 demo 数据导入收敛为一条命令，优先使用：

```bash
npm run init:local -- --admin-user admin --admin-password your-password --with-demo
```

如果需要手动导入管理员，也可以继续使用 seed 脚本：

```bash
npm run seed:admin -- admin your-password
npm run seed:admin -- admin your-password | npx wrangler d1 execute subforge --local --file=-
```

## 导入 Demo 数据

```bash
npm run seed:demo | npx wrangler d1 execute subforge --local --file=-
```

脚本会输出 demo 用户 token，可直接测试：

- `/s/:token/mihomo`
- `/s/:token/singbox`

## 关键环境变量

- `ADMIN_JWT_SECRET`：管理员会话签名密钥
- `ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC`：管理员登录失败限流窗口秒数，默认 `600`
- `ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`：管理员登录失败窗口内最大尝试次数，默认 `5`
- `SUBSCRIPTION_CACHE_TTL`：公开订阅缓存 TTL，默认 `1800`
- `SUBSCRIPTION_RATE_LIMIT_WINDOW_SEC`：公开订阅频控窗口秒数，默认 `60`
- `SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS`：公开订阅窗口内最大请求数，默认 `60`
- `PREVIEW_CACHE_TTL`：预览缓存 TTL，默认 `120`
- `SYNC_HTTP_TIMEOUT_MS`：规则源拉取超时，默认 `10000`
- `VITE_API_BASE_URL`：前端 API 基地址

## 部署摘要

- 当前仓库默认走 **单 Worker + 静态资源** 部署，所有请求会先进 Worker，再由 Worker 把非 API 请求回退到 `apps/web/dist`
- `wrangler.toml` 继续保持“无资源 ID”模式，并启用 `run_worker_first = true`；这依赖 **`wrangler@4.45.0` 及以上** 自动 provision D1 / KV 绑定
- 根 `package.json` 中 `npm run build` 只构建前端，`npm run deploy` 负责远端 migration + Worker 发布，更适合 Cloudflare UI / Git 导入
- 如需把远端构建、部署和首轮数据初始化收敛成单条命令，可执行 `npm run init:remote -- --admin-user admin --admin-password your-password`
- 首次部署后可直接通过后台首次安装向导创建管理员，无需先跑 `seed:admin`
- 如果需要完整的 Cloudflare UI / Git 导入、绑定清单、GitHub Actions、D1 备份 / 恢复 SOP、部署后验收与首轮排障步骤，请看 `docs/部署指南.md`

## 自动化

- 已提供 `GitHub Actions`：`.github/workflows/ci.yml` 会在 `push` / `pull_request` / 手动触发时执行 `npm run ci:verify`，依次覆盖 `test:contract -> smoke -> npm test -> test:unit -> typecheck -> build -> build:worker`
- `.github/workflows/deploy.yml` 现在采用简单分支策略：`release/*` 分支 push 自动走 `staging` 环境，`main` 分支 push 自动走 `production` 环境；手动触发时也可显式选择 `staging` / `production`
- staging 发布会执行 `npm run deploy:staging`，production 发布继续执行 `npm run deploy`；两者都会先复用同一条 `npm run ci:verify`
- CI workflow 会取消同一分支上被后续提交覆盖的旧检查；deploy workflow 会按环境分开串行，避免 staging / production 互相抢占
- 仓库根目录已提交 `.nvmrc` 与 `.node-version` 并固定为 `20`，用于让 Cloudflare Workers Builds 与 GitHub Actions 的 Node 版本保持一致
- 仓库已提交 `package-lock.json`，workflow 当前默认使用 `npm ci`；如需更新依赖版本，再在本地执行 `npm install`
- 新增 `.github/workflows/d1-backup.yml`：每天定时为 production 导出一份 D1 备份，默认保留 `30` 天；如配置 `D1_BACKUP_ARCHIVE_PASSPHRASE`，会自动加密后再上传 artifact
- 如需把备份继续同步到 S3 兼容对象存储，可配置 `D1_BACKUP_ARCHIVE_S3_URI`、`D1_BACKUP_ARCHIVE_ENDPOINT_URL`、`D1_BACKUP_ARCHIVE_SSE`、`D1_BACKUP_ARCHIVE_KMS_KEY_ID` 等变量 / Secret；workflow 会额外执行 `aws s3 cp`，并在 summary 中提示 bucket lifecycle 需在存储侧配置
- 新增 `npm run backup:d1:encrypted`、`npm run backup:d1:decrypt` 与 `npm run d1:restore:drill -- --file <backup.sql|backup.sql.enc>`，方便本地加密归档、解密与恢复演练
- 新增 `.github/workflows/failure-alert.yml`：当 `CI`、`Deploy` 或 `D1 Backup` 失败时会生成 GitHub Actions failure summary；如配置 `FAILURE_WEBHOOK_URL`，还会把通用 JSON payload 推送到外部 webhook

本地安装依赖后，如需镜像 GitHub Actions 的完整校验链路，可执行：

```bash
npm run ci:verify
```

如在受限沙箱或只读 home 目录里执行 `wrangler --dry-run`，可临时把 Wrangler 的配置目录和输出目录改到可写路径：

```bash
XDG_CONFIG_HOME=/tmp WRANGLER_OUTPUT_FILE_DIRECTORY=/tmp npm run ci:verify
```

如果只想做最小检查，也可以按下面顺序逐条执行：

```bash
npm run test:contract
npm run test:smoke
npm test
npm run test:unit
npm run typecheck
npm run build
npm run build:worker
```

## 文档入口

- `docs/INDEX.md`：总导航与阅读顺序；如果你不确定先看哪篇，先从这里进入
- `docs/部署指南.md`：本地运行、Cloudflare 部署、GitHub Actions、D1 备份 / 恢复 SOP、发布与回滚 checklist
- `docs/运维Runbook与告警处理.md`：巡检、告警建议、恢复演练、值班响应与发布回滚策略
- `docs/API错误码与响应头说明.md`：协议、错误码、缓存头与限流头速查
- `docs/API错误响应示例库.md`：可直接复制到联调 / Mock / 测试里的 4xx / 5xx 响应示例
- `docs/API接口矩阵与OpenAPI草案.md`：路由矩阵、鉴权范围与阅读说明
- `openapi.yaml`：机器可读的正式 API 契约，可直接导入 Swagger Editor / Redocly，且已补关键 request / response examples
- `npm run test:contract`：纯 Node.js 的契约漂移检查，校验前端路由清单、公开鉴权边界与 `openapi.yaml` 是否一致
- `docs/限流与安全策略.md`：管理员登录失败限流、公开订阅频控、调参建议与安全边界
- `docs/排障与常见问题.md`：症状驱动 FAQ 与高频报错排查
- `docs/数据模型与表结构说明.md`：当前 D1 表结构、索引、关系、共享类型映射
- `docs/架构图与ER图.md`：运行时拓扑、关键数据流、Mermaid 架构图与 D1 实体关系图
- `docs/实施方案.md`：长期设计基线、模块边界与架构原则
- `CHANGELOG.md`：版本变更与已完成项记录
- `.omx/plans/2026-03-07-subforge-roadmap.md`：当前实现进度与阶段拆分
