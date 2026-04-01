# SubForge 历史执行路线图（归档）

归档说明：

- 本文档保留的是早期阶段拆分与执行顺序
- 文中包含旧的“后台界面 / 用户管理页 / 规则源管理页”等历史命名
- 它不再代表当前产品入口、当前前端主界面或当前清理顺序
- 当前以 `README.md`、`docs/INDEX.md` 与 `docs/仓库清理与收敛计划.md` 为准

## 目标

基于 `docs/单用户托管模式需求.md` 与 `docs/实施方案.md`，按阶段把 SubForge 从空仓库逐步实现为可部署的 Cloudflare 单用户订阅托管工具。

## 决策

- 使用 Monorepo
- 使用 `npm workspaces`
- 使用 React + Vite 构建后台
- 使用 Cloudflare Workers + D1 + KV + Cron 构建服务端
- 先做 MVP，再做增强功能

## 阶段拆分

### P0：工程初始化
- 建立根 `package.json`
- 初始化 `apps/web`
- 初始化 `apps/worker`
- 建立根 tsconfig、基础脚本
- 增加 `wrangler.toml`
- 编写首版 migration

状态：已完成

### P1：核心领域模型
- 建立 `packages/shared` 领域类型
- 建立 `packages/core` 订阅中间模型
- 定义 renderer 接口
- 定义错误码和 cache key
- 定义订阅编译入口

状态：已完成

### P2：数据层与 API
- 实现数据库访问层
- 实现管理员登录
- 实现用户 / 节点 / 模板 / 规则源 CRUD
- 实现公开订阅接口
- 实现后台预览接口

状态：已完成

### P3：后台界面
- 登录页
- 用户管理页
- 节点管理页
- 模板管理页
- 规则源管理页
- 同步日志 / 审计日志页
- 订阅预览页

状态：已完成

### P4：同步与缓存
- 手动同步
- Cron 同步
- KV 缓存
- 预览缓存
- 按用户 / 节点 / 模板粒度失效
- 用户节点绑定
- 同步日志
- 审计日志

状态：已完成（持续增强中）

### P5：上线前完善
- 审计字段增强
- 更强的规则同步错误展示
- 部署文档补完
- CI / CD 脚本
- 一键初始化流程

状态：已完成

## 本轮已完成

- 前端补齐资源创建 + 编辑表单，并增加基础表单校验
- 增加用户节点绑定面板
- 增加同步结果、同步日志、审计日志展示
- 后端补齐资源更新接口、输入校验与审计记录
- 审计日志联表管理员名称，并附带请求上下文
- 规则源同步支持 `text/yaml/json` 轻量解析、去重、哈希比较与结构化 details
- 缓存策略细化到预览缓存、节点影响用户、模板影响目标类型
- 增加零依赖 `test:smoke` 检查脚本
- 增加首次安装向导与初始管理员创建 API
- 调整 `wrangler.toml` 为更友好的 Dashboard / Git 导入默认配置
- 增加 Deploy to Cloudflare 按钮模板与部署脚本
- 把 `apps/web` 作为 Worker 静态资源一起部署，减少 Pages 依赖
- 增强规则源轻量解析覆盖面，并补齐阶段 / 错误码 / 提取统计等同步详情
- 补管理员登录失败限流与公开订阅频控
- 增加 `init:local` / `init:remote` 一键初始化脚本，收敛本地与远端首轮初始化流程
- 增加零额外依赖的 `test:unit` 核心单测入口，并接入 CI / deploy 检查链路
- 补远程节点源手动同步入口，并为节点导入增加基于节点指纹的去重策略
- 补审计日志资源展示名、请求方法 / 路径 / Ray 等字段，并优化后台审计表格展示
- 增强规则同步错误展示，补充建议 / 可重试标记 / 支持结构 / 内容预览
- 补 Cloudflare Dashboard / Git 导入、绑定清单、部署后验收与首轮排障文档
- 收敛 CI / deploy workflow 校验链路，新增 `npm run ci:verify` 并补手动触发 / 并发控制说明
- 修正内部 workspace 依赖声明以兼容 npm，提交 `package-lock.json` 并把 workflow 切换到 `npm ci`
- 增加 `staging` 环境脚本与 `release/* -> staging` / `main -> production` 分支策略，并补 GitHub Actions failure alert workflow
- 补发布与回滚 checklist，覆盖 staging 验收、production 审批、`workflow_dispatch` 回滚与 D1 数据回退边界
- 补 D1 备份 / 恢复 SOP，覆盖 `wrangler d1 export` / `execute`、full export 空库恢复约束与敏感备份留存要求
- 增加 `scripts/d1-backup.mjs`、`scripts/d1-restore-drill.mjs` 与 `.github/workflows/d1-backup.yml`，收敛 D1 定期备份、artifact 留存与本地恢复演练命令
- 增加 `scripts/d1-backup-crypto.mjs`、`scripts/d1-backup-decrypt.mjs` 与 `D1_BACKUP_ARCHIVE_PASSPHRASE` 加密归档链路，支持加密 artifact、`.sha256` 校验与加密备份恢复演练
- 增加 D1 备份 artifact 可选对象存储同步，支持 `D1_BACKUP_ARCHIVE_S3_URI`、S3 兼容 endpoint、SSE / KMS 约束校验与 lifecycle summary
- 增加 `openapi.yaml` 作为正式 API 契约，覆盖 `/health`、`/api/*`、`/s/{token}/{target}`、统一错误包裹与关键响应头
- 增加 `docs/架构图与ER图.md`，补运行时拓扑、关键数据流、Mermaid 架构图与 D1 实体关系图
- 把常见 `400` / `401` / `403` / `404` / `429` 与 `5xx` 说明收敛进 API 专题文档，并同步 `openapi.yaml` 响应 examples
- 细化 `openapi.yaml` 的关键 request / success examples，补公开订阅内容示例，并将 `PreviewMetadata` 从泛型对象收紧为显式 schema
- 增加 `scripts/openapi-contract-check.mjs` 与 `npm run test:contract`，校验公开鉴权边界、关键 schema 与 `apps/web/src/api.ts` 路径是否与 `openapi.yaml` 保持一致
- 已补 `ssr` / `tuic` / `hysteria2` 的 share-link import、完整配置提取与订阅编译协议矩阵回归
- 已补自动同步源重连绑定、节点更新、模板切换、规则源启停 / 同步后的 preview/public 一致性长链路回归
- 已把 README、实施方案、数据模型、API 草案、发布前检查清单统一收敛到当前单用户主路径和自动同步源边界

## 当前推荐执行项

1. 继续保持单用户主路径边界稳定：长期自动同步只走 `remote_subscription_sources`，不要再把更通用远程节点源扩写成新的 Cron / 持久化对象
2. 如果继续增强实现，优先围绕真实输入样本补解析鲁棒性与回归测试，而不是先扩故事线
3. 每次发布前固定执行 `XDG_CONFIG_HOME=/tmp WRANGLER_OUTPUT_FILE_DIRECTORY=/tmp npm run ci:verify`，并按 `docs/发布前检查清单.md` 完成最小人工验收
