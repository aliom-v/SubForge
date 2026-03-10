# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Docs

- 统一 `README.md`、`docs/INDEX.md`、`docs/部署指南.md`、`docs/实施方案.md`、`docs/API错误码与响应头说明.md`、`docs/限流与安全策略.md`、`docs/排障与常见问题.md`、`docs/运维Runbook与告警处理.md` 的职责边界
- 删除重复的协议、部署、排障与巡检说明，改为交叉引用维护
- 修正文档中的表数量、导航说明与阅读顺序，使 `README.md` 更偏入口、`docs/部署指南.md` 更偏操作、`docs/实施方案.md` 更偏设计基线
- 同步 `docs/运维Runbook与告警处理.md`、`docs/INDEX.md` 的 CI/CD 入口描述，补齐 `npm run ci:verify` 发布前检查说明
- 同步 `README.md`、`docs/部署指南.md`、`docs/排障与常见问题.md` 的依赖安装说明，切到带 lockfile 的 `npm ci` 流程
- 同步 `README.md`、`docs/部署指南.md`、`docs/INDEX.md`、`docs/运维Runbook与告警处理.md` 的 staging / production 分支策略与失败告警说明
- 补 `docs/部署指南.md` 与 `docs/运维Runbook与告警处理.md` 的发布 / 回滚 checklist，覆盖 staging 验收、production 审批、`workflow_dispatch` 回滚与 D1 数据回退边界
- 补 `docs/部署指南.md` 与 `docs/运维Runbook与告警处理.md` 的 D1 备份 / 恢复 SOP，覆盖 `wrangler d1 export` / `execute`、full export 空库恢复约束与敏感备份留存要求
- 新增 `scripts/d1-backup.mjs`、`scripts/d1-restore-drill.mjs` 与 `.github/workflows/d1-backup.yml`，把 D1 定期备份、artifact 留存与本地恢复演练命令收敛为仓库原生命令
- 新增 `scripts/d1-backup-crypto.mjs`、`scripts/d1-backup-decrypt.mjs` 与 `D1_BACKUP_ARCHIVE_PASSPHRASE` 加密归档链路，支持加密 artifact、`.sha256` 校验与加密备份恢复演练
- 同步 `README.md`、`docs/部署指南.md`、`docs/运维Runbook与告警处理.md`、`docs/INDEX.md` 的对象存储 / KMS 归档说明，补齐 `D1_BACKUP_ARCHIVE_S3_URI`、S3 兼容 endpoint、SSE / KMS 约束与 bucket lifecycle 提示
- 新增 `openapi.yaml` 作为正式 API 契约入口，并同步 `README.md`、`docs/INDEX.md`、`docs/API接口矩阵与OpenAPI草案.md` 的 OpenAPI 导航说明
- 新增 `docs/架构图与ER图.md`，沉淀运行时拓扑、关键数据流、Mermaid 架构图与 D1 实体关系图
- 新增 `docs/API错误响应示例库.md`，补常见 `400` / `401` / `403` / `404` / `429` 示例，并说明当前 5xx 现状；同步 `openapi.yaml` 响应 examples
- 细化 `openapi.yaml` 的关键 request / success examples，补公开订阅内容示例，并将 `PreviewMetadata` 从泛型对象收紧为显式 schema
- 新增 `scripts/openapi-contract-check.mjs` 与 `npm run test:contract`，对 `openapi.yaml`、公开鉴权边界与 `apps/web/src/api.ts` 调用路径做零依赖契约校验

### DevOps

- 新增 `npm run ci:verify`，复用 `contract -> smoke -> npm test -> test:unit -> typecheck -> build -> build:worker` 校验链路
- `CI` / `Deploy` workflow 改为复用同一条校验脚本，CI 增加手动触发与同分支旧运行自动取消
- 修正内部 workspace 依赖声明并提交 `package-lock.json`，把 workflow 安装步骤切换为 `npm ci`
- `.github/workflows/d1-backup.yml` 新增可选对象存储同步，支持 `D1_BACKUP_ARCHIVE_S3_URI`、S3 兼容 endpoint、`D1_BACKUP_ARCHIVE_SSE` / `D1_BACKUP_ARCHIVE_KMS_KEY_ID` 校验与 lifecycle summary
- 新增 `staging` Worker / D1 / KV 环境脚本，deploy workflow 按 `release/*` / `main` 分支映射到 `staging` / `production`，并补 failure alert workflow

## [0.1.0] - 2026-03-09

### Added

- 初始化 monorepo：`apps/web`、`apps/worker`、`packages/core`、`packages/shared`
- Cloudflare Worker API、D1、KV、Cron 与静态资源一体化部署骨架
- 首次安装向导与初始管理员创建流程
- 管理员登录、会话校验与退出接口
- 用户 CRUD、用户 token 重置、用户节点绑定
- 节点 CRUD 与 JSON 批量导入
- 模板创建、更新与默认模板切换
- 规则源创建、更新、手动同步与 Cron 同步
- 公开订阅接口 `/s/:token/:target`
- 后台预览接口 `/api/preview/:userId/:target`
- 同步日志与审计日志接口与后台展示
- 手动缓存重建入口与按用户 / 节点 / 模板粒度的缓存失效策略

### Changed

- 规则源同步增强为 `text` / `yaml` / `json` 轻量解析，并记录结构化 `details`
- 同步日志增加阶段、错误码、规则数、提取 / 重复 / 忽略统计等信息
- 后台规则源列表与同步状态展示增强
- 部署方式调整为 Worker-first + `ASSETS` 静态资源回退，减少对 Pages 的依赖

### Security

- 新增管理员登录失败限流
- 新增公开订阅频控
- 审计日志附带请求上下文（IP、国家、colo、UA）

### DevOps

- 新增 `Deploy to Cloudflare` 按钮模板
- 新增 `.github/workflows/ci.yml` 与 `.github/workflows/deploy.yml`
- 新增零依赖 `npm run test:smoke` 静态回归校验
