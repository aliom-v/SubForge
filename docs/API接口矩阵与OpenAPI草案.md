# SubForge API 接口矩阵与 OpenAPI 草案

## 1. 这篇文档负责什么

本文档只保留“接口清单”视角，回答这 3 个问题：

- 当前有哪些公开路由和后台路由
- 哪些路由需要管理员 Bearer token
- 正式 OpenAPI 在哪里，应该怎么和其他 API 文档配合阅读

为避免重复维护，以下公共协议细节统一放到 `docs/API错误码与响应头说明.md`：

- `Authorization: Bearer <admin-session-token>` 的完整说明
- JSON 成功 / 失败包裹结构
- 常见错误码与状态码
- `x-subforge-cache-key`、`retry-after`、限流头等响应头

## 2. 图例与公开入口

- 表中“Bearer”表示需要管理员会话
- 表中“无”表示公开入口

当前无需管理员鉴权的入口：

- `GET /health`
- `GET /api/setup/status`
- `POST /api/setup/bootstrap`
- `POST /api/admin/login`
- `GET /s/:token/:target`

如果你更关心字段级响应、错误码或缓存 / 限流头，请优先看 `docs/API错误码与响应头说明.md`；如果你想直接复制 4xx / 5xx JSON 响应，请看 `docs/API错误响应示例库.md`。

## 3. 接口矩阵

### 3.1 公共与系统接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | 无 | 健康检查 | 返回服务名、环境、时间、示例缓存 key |
| `GET` | `/api/setup/status` | 无 | 查询是否已初始化 | 返回 `initialized` 与 `adminCount` |
| `POST` | `/api/setup/bootstrap` | 无 | 首次创建管理员 | 仅首次初始化可用，成功后直接返回登录态 |
| `POST` | `/api/admin/login` | 无 | 管理员登录 | 含登录失败限流 |
| `GET` | `/s/:token/:target` | 无 | 公开订阅输出 | 受公开订阅频控与订阅缓存影响 |

### 3.2 管理员会话接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/admin/me` | Bearer | 查询当前管理员 | 校验会话是否有效 |
| `POST` | `/api/admin/logout` | Bearer | 退出登录 | 服务端撤销当前会话；成功返回 `loggedOut`、`serverRevocation`、`mode` 与可选 `revokedAt` |

### 3.3 用户接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/users` | Bearer | 用户列表 | 返回全部用户 |
| `POST` | `/api/users` | Bearer | 创建用户 | 创建后自动生成订阅 token |
| `PATCH` | `/api/users/:id` | Bearer | 更新用户 | 支持名称、状态、过期时间、备注 |
| `POST` | `/api/users/:id/reset-token` | Bearer | 重置用户 token | 会失效旧 token 对应缓存 |
| `GET` | `/api/users/:id/nodes` | Bearer | 查询用户绑定节点 | 返回绑定列表 |
| `POST` | `/api/users/:id/nodes` | Bearer | 替换用户节点绑定 | body 中需带 `nodeIds` 数组 |

### 3.4 节点接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/nodes` | Bearer | 节点列表 | 返回全部节点 |
| `POST` | `/api/nodes` | Bearer | 创建节点 | 支持 `credentials` / `params` |
| `POST` | `/api/nodes/import` | Bearer | 批量导入节点 | 单次最多 200 条 |
| `POST` | `/api/nodes/import/remote` | Bearer | 拉取远程节点源并同步 | 当前要求远端返回 JSON 数组或 `{"nodes": [...]}`；会按节点指纹去重并禁用旧远程节点 |
| `PATCH` | `/api/nodes/:id` | Bearer | 更新节点 | 节点变更会失效受影响用户缓存 |
| `DELETE` | `/api/nodes/:id` | Bearer | 删除节点 | 删除后也会失效受影响用户缓存 |

### 3.5 模板接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/templates` | Bearer | 模板列表 | 返回全部模板 |
| `POST` | `/api/templates` | Bearer | 创建模板 | 可指定目标类型、版本、默认状态 |
| `PATCH` | `/api/templates/:id` | Bearer | 更新模板 | 可能触发按目标类型的缓存失效 |
| `POST` | `/api/templates/:id/set-default` | Bearer | 设为默认模板 | 变更默认模板后触发缓存失效 |

### 3.6 规则源接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/rule-sources` | Bearer | 规则源列表 | 返回同步状态与失败次数 |
| `POST` | `/api/rule-sources` | Bearer | 创建规则源 | 支持 `text` / `yaml` / `json` |
| `PATCH` | `/api/rule-sources/:id` | Bearer | 更新规则源 | 可修改 URL、格式、启用状态 |
| `POST` | `/api/rule-sources/:id/sync` | Bearer | 立即同步规则源 | 返回结构化同步结果 |

### 3.7 日志与缓存接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/sync-logs` | Bearer | 查看同步日志 | 返回最近同步记录，`details` 含错误诊断与处理建议 |
| `GET` | `/api/audit-logs` | Bearer | 查看审计日志 | 联表带管理员用户名、资源展示名，并拆出请求上下文 |
| `POST` | `/api/cache/rebuild` | Bearer | 手动重建订阅缓存 | 当前行为是清理缓存，不主动预热 |

### 3.8 预览接口

| 方法 | 路径 | 鉴权 | 用途 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/preview/:userId/:target` | Bearer | 拉取用户预览订阅 | 返回 JSON 包裹和预览缓存头 |

## 4. 正式 OpenAPI 入口

仓库现在已经提供正式规范文件：`openapi.yaml`。

建议这样配合使用：

- `docs/API接口矩阵与OpenAPI草案.md`：优先用于人工阅读，快速确认有哪些路由、哪些接口需要 Bearer token
- `openapi.yaml`：优先用于 Swagger Editor、Redoc、OpenAPI Generator、前后端联调与契约校验
- `npm run test:contract`：纯 Node.js 的契约漂移检查，会校验公开接口鉴权边界、前端路由清单与 `openapi.yaml` 是否一致
- `docs/API错误码与响应头说明.md`：补充错误码、缓存头、限流头与鉴权语义
- `docs/API错误响应示例库.md`：提供可直接复制的 4xx / 5xx 响应样例

当前 `openapi.yaml` 已覆盖：

- `/health`、`/api/setup/*`、`/api/admin/*`
- `/api/users*`、`/api/nodes*`、`/api/templates*`、`/api/rule-sources*`
- `/api/node-import/preview`、`/api/sync-logs`、`/api/audit-logs`、`/api/cache/rebuild`、`/api/preview/{userId}/{target}`
- `/s/{token}/{target}` 公开订阅接口
- 关键请求 / 成功 / 错误 examples，包括初始化、登录、用户 / 节点 / 模板 / 规则源写接口、预览与公开订阅内容
- 共享枚举、统一错误包裹、常用缓存 / 限流响应头，以及 `PreviewMetadata` 等已知稳定字段约束

## 5. 相关文档

- `docs/API错误码与响应头说明.md`
- `docs/API错误响应示例库.md`
- `docs/限流与安全策略.md`
- `docs/部署指南.md`
- `docs/排障与常见问题.md`
