# SubForge 架构图、ER 图与数据模型

## 1. 文档目的

这份文档把当前仓库里已经落地的系统结构收敛成三部分，其中前两部分会直接用 Mermaid 图表达：

- 运行时架构图：帮助快速理解 `apps/web`、`apps/worker`、`packages/core`、`packages/shared`、Cloudflare 绑定资源与外部依赖如何协同
- ER 图：帮助快速理解 D1 中的核心实体、主外键关系、哪些表是“源数据”、哪些表是“观测与追踪数据”
- 数据模型说明：帮助快速理解当前 D1 表结构、关键字段、索引、共享类型映射与 API / Worker 行为

与其他文档的分工：

- `docs/实施方案.md`：解释为什么这样分层、模块边界如何演进
- `docs/API参考与接口约定.md` 与 `openapi.yaml`：解释接口契约，而不是数据库关系
- `docs/部署指南.md`：解释 Cloudflare / GitHub Actions / D1 备份恢复操作步骤

## 2. 阅读约定

阅读这份文档时，可以先记住 5 个原则：

1. Worker 是唯一对外运行时入口：既处理 `/api/*` 与 `/s/:token/:target`，也兜底静态资源 `ASSETS`
2. D1 存“源数据”，KV `SUB_CACHE` 存“派生缓存”，缓存随数据变化被清理，不作为事实来源
3. `packages/core` 负责订阅编译，`packages/shared` 负责共享类型、常量、错误码与 cache key 约定
4. Cron、手动同步、GitHub Actions 备份都属于运维/调度平面，会围绕同一个 Worker / D1 数据面工作
5. 本文档只描述当前仓库 migration 与共享类型中已经落地的结构，不承担长期演进蓝图职责

## 3. 运行时架构图

### 3.1 总体架构

```mermaid
flowchart LR
  Admin["管理员浏览器<br/>后台 SPA"]
  Subscriber["公开订阅客户端<br/>Mihomo / sing-box"]
  GHA["GitHub Actions<br/>CI / Deploy / D1 Backup"]
  External["外部上游<br/>规则源 / 远程节点源"]
  ObjectStorage["对象存储<br/>S3 / R2 / MinIO"]

  subgraph Repo[Monorepo]
    Web["apps/web<br/>React + Vite"]
    Worker["apps/worker<br/>Cloudflare Worker"]
    Core["packages/core<br/>订阅编译 / renderer"]
    Shared["packages/shared<br/>类型 / 常量 / 错误码"]
  end

  subgraph CF[Cloudflare Runtime]
    Assets["ASSETS<br/>静态资源绑定"]
    D1[(D1: DB)]
    KV[(KV: SUB_CACHE)]
    Cron["Cron Trigger<br/>每小时规则同步"]
  end

  Admin --> Web
  Web -->|/api/*| Worker
  Subscriber -->|/s/:token/:target| Worker
  Worker --> Assets
  Worker --> D1
  Worker --> KV
  Worker --> Core
  Worker --> Shared
  Core --> Shared
  Cron --> Worker
  Worker -->|fetch| External
  GHA -->|wrangler d1 export| D1
  GHA -->|artifact / aws s3 cp| ObjectStorage
```

### 3.2 分层说明

- `apps/web`
  - 管理后台单页应用
  - 通过 `apps/web/src/api.ts` 调用 Worker API
  - 不直接访问 D1 / KV
- `apps/worker`
  - 对外暴露 `/health`、`/api/*`、`/s/:token/:target`
  - 负责鉴权、参数校验、D1 读写、缓存失效、Cron 同步、审计与同步日志
  - 通过 `env.ASSETS.fetch(request)` 兜底前端静态资源
- `packages/core`
  - 负责把用户、节点、模板、规则快照拼成订阅编译输入
  - 根据 `target = mihomo | singbox` 选择 renderer 输出最终内容
- `packages/shared`
  - 负责共享枚举、领域类型、错误码、cache key、目标类型常量
  - 是 `web` / `worker` / `core` 三方共享的稳定边界
- `D1`
  - 存管理员、用户、节点、模板、规则源、规则快照、绑定关系、同步日志、审计日志
- `SUB_CACHE`
  - 存预览缓存与公开订阅缓存
  - key 由共享层统一生成，值可丢失、可重建

## 4. 关键数据流

### 4.1 管理后台请求流

```mermaid
sequenceDiagram
  participant A as 管理员浏览器
  participant W as apps/web
  participant API as Worker API
  participant DB as D1
  participant KV as SUB_CACHE

  A->>W: 打开后台 / 提交表单
  W->>API: Bearer 调用 /api/*
  API->>API: 鉴权 + 参数校验
  API->>DB: 查询或写入源数据
  API->>KV: 失效受影响的 preview/subscription 缓存
  API-->>W: 返回统一 JSON 包裹
  W-->>A: 刷新列表 / 预览 / 日志
```

### 4.2 公开订阅输出流

```mermaid
sequenceDiagram
  participant C as 订阅客户端
  participant API as Worker /s 路由
  participant KV as SUB_CACHE
  participant DB as D1
  participant Core as packages/core

  C->>API: GET /s/{token}/{target}
  API->>API: 频控检查 + target 校验
  API->>KV: 读取订阅缓存
  alt cache hit
    KV-->>API: 已缓存的订阅原文
    API-->>C: 直接返回内容 + 缓存头
  else cache miss
    API->>DB: 读取用户/节点/模板/规则快照
    API->>Core: compileSubscription(input)
    Core-->>API: mimeType + content + metadata
    API->>KV: 写入缓存
    API-->>C: 返回订阅原文 + 缓存头
  end
```

### 4.3 同步与运维流

```mermaid
flowchart TD
  Cron[Cron Trigger] --> Sync[Worker scheduled()]
  Manual[管理员手动同步] --> Sync
  Sync --> Fetch[拉取规则源 / 远程节点源]
  Fetch --> Normalize[解析 / 归一化 / 去重]
  Normalize --> D1Write[写入 rule_sources / rule_snapshots / nodes]
  D1Write --> Logs[写入 sync_logs / audit_logs]
  D1Write --> CacheInvalidate[清理受影响缓存]

  Backup[GitHub Actions D1 Backup] --> Export[wrangler d1 export]
  Export --> Archive[artifact / .enc / .sha256]
  Archive --> Storage[GitHub Artifact / 对象存储]
```

说明：

- Cron 当前负责启用中的规则源同步和远程订阅自动同步源；更通用的远程 JSON 节点源同步仍以手动触发为主
- 远程规则源 / 远程订阅源 / 远程节点源都属于“外部输入”，写库前会做解析和校验
- 备份链路不参与在线请求，但属于同一套数据平面的保护能力

## 5. ER 图

```mermaid
erDiagram
  ADMINS ||--o{ AUDIT_LOGS : actor_admin_id
  USERS ||--o{ USER_NODE_MAP : user_id
  NODES ||--o{ USER_NODE_MAP : node_id
  RULE_SOURCES ||--o{ RULE_SNAPSHOTS : rule_source_id

  ADMINS {
    text id PK
    text username UK
    text password_hash
    text role
    text status
    text created_at
    text updated_at
  }

  USERS {
    text id PK
    text name
    text token UK
    text status
    text expires_at
    text remark
    text created_at
    text updated_at
  }

  NODES {
    text id PK
    text name
    text protocol
    text server
    int port
    text credentials_json
    text params_json
    text source_type
    text source_id
    int enabled
    text last_sync_at
    text created_at
    text updated_at
  }

  TEMPLATES {
    text id PK
    text name
    text target_type
    text content
    int version
    int is_default
    int enabled
    text created_at
    text updated_at
  }

  RULE_SOURCES {
    text id PK
    text name
    text source_url
    text format
    int enabled
    text last_sync_at
    text last_sync_status
    int failure_count
    text created_at
    text updated_at
  }

  RULE_SNAPSHOTS {
    text id PK
    text rule_source_id FK
    text content_hash
    text content
    text created_at
  }

  REMOTE_SUBSCRIPTION_SOURCES {
    text id PK
    text name
    text source_url
    int enabled
    text last_sync_at
    text last_sync_status
    int failure_count
    text created_at
    text updated_at
  }

  USER_NODE_MAP {
    text id PK
    text user_id FK
    text node_id FK
    int enabled
    text created_at
  }

  SYNC_LOGS {
    text id PK
    text source_type
    text source_id
    text status
    text message
    text details_json
    text created_at
  }

  AUDIT_LOGS {
    text id PK
    text actor_admin_id FK
    text action
    text target_type
    text target_id
    text payload_json
    text created_at
  }
```

## 6. 数据模型总览

### 6.1 核心表

当前 D1 由这 10 张核心表组成：

- `admins`
- `users`
- `nodes`
- `templates`
- `rule_sources`
- `remote_subscription_sources`
- `rule_snapshots`
- `user_node_map`
- `sync_logs`
- `audit_logs`

其中：

- `admins` 负责后台管理员账号
- `users` 负责订阅用户与公开 token
- `nodes` 负责节点元数据
- `templates` 负责目标类型模板
- `rule_sources` / `rule_snapshots` 负责远程规则源与快照
- `remote_subscription_sources` 负责长期自动同步的上游订阅源元数据
- `user_node_map` 负责用户和节点绑定
- `sync_logs` / `audit_logs` 负责观测与追踪

### 6.2 共享枚举与约束

当前共享层中实际使用的关键枚举：

- `SubscriptionTarget`
  - `mihomo`
  - `singbox`
- `UserStatus`
  - `active`
  - `disabled`
- `AdminStatus`
  - `active`
  - `disabled`
- `AdminRole`
  - `admin`
- `NodeSourceType`
  - `manual`
  - `remote`
- `RuleSourceFormat`
  - `yaml`
  - `json`
  - `text`
- `SyncLogStatus`
  - `success`
  - `failed`
  - `skipped`

### 6.3 表结构速览

#### `admins`

用途：

- 存储后台管理员账号
- 登录时按 `username` 查询
- 会话 token 的 `sub` 指向管理员 `id`

主要字段：

- `id`
- `username`
- `password_hash`
- `role`
- `status`
- `created_at`
- `updated_at`

#### `users`

用途：

- 存储订阅用户
- `token` 用于公开订阅 `/s/:token/:target`

主要字段：

- `id`
- `name`
- `token`
- `status`
- `expires_at`
- `remark`
- `created_at`
- `updated_at`

相关行为：

- 创建用户时自动生成高熵 token
- 用户资料或 token 变更会失效对应缓存

#### `nodes`

用途：

- 存储节点基础信息
- 供订阅编译时组装代理节点列表

主要字段：

- `id`
- `name`
- `protocol`
- `server`
- `port`
- `credentials_json`
- `params_json`
- `source_type`
- `source_id`
- `enabled`
- `last_sync_at`
- `created_at`
- `updated_at`

相关行为：

- 当前支持单个创建、更新、删除与 JSON 批量导入
- 节点更新或删除会失效受影响用户缓存

#### `templates`

用途：

- 存储订阅模板
- 按 `target_type` 区分 `mihomo` 与 `singbox`

主要字段：

- `id`
- `name`
- `target_type`
- `content`
- `version`
- `is_default`
- `enabled`
- `created_at`
- `updated_at`

相关行为：

- 每个目标类型允许切换默认模板
- 默认模板变化会触发按目标类型的缓存失效

#### `rule_sources`

用途：

- 记录远程规则源配置
- 保存最近同步状态和失败次数

主要字段：

- `id`
- `name`
- `source_url`
- `format`
- `enabled`
- `last_sync_at`
- `last_sync_status`
- `failure_count`
- `created_at`
- `updated_at`

相关行为：

- 支持手动同步与 Cron 同步
- 同步后会写入 `sync_logs`
- 同步成功且内容变化时写入 `rule_snapshots`

#### `remote_subscription_sources`

用途：

- 记录长期自动同步的上游订阅 URL
- 保存启用状态、最近同步状态和失败次数

主要字段：

- `id`
- `name`
- `source_url`
- `enabled`
- `last_sync_at`
- `last_sync_status`
- `failure_count`
- `created_at`
- `updated_at`

相关行为：

- 支持手动同步与 Cron 同步
- 同步时会把解析出的节点写入 `nodes`
- 同步后会写入 `sync_logs`，并刷新受影响绑定和缓存

#### `rule_snapshots`

用途：

- 保存规则源内容快照
- 用于去重、内容哈希比较与订阅编译读取

主要字段：

- `id`
- `rule_source_id`
- `content_hash`
- `content`
- `created_at`

关系：

- `rule_source_id -> rule_sources.id`

相关行为：

- 同一规则源 + 相同 `content_hash` 不会重复插入
- 编译订阅时会读取每个规则源最新快照

#### `user_node_map`

用途：

- 管理用户与节点的多对多绑定关系

主要字段：

- `id`
- `user_id`
- `node_id`
- `enabled`
- `created_at`

关系：

- `user_id -> users.id`
- `node_id -> nodes.id`
- `(user_id, node_id)` 唯一

相关行为：

- 当前通过“替换绑定列表”方式写入
- 绑定变化会触发用户缓存失效

#### `sync_logs`

用途：

- 记录规则源同步结果

主要字段：

- `id`
- `source_type`
- `source_id`
- `status`
- `message`
- `details_json`
- `created_at`

相关行为：

- 当前主要记录 `rule_source` 同步
- `details_json` 中会保存阶段、错误码、规则数、耗时、内容哈希等结构化信息

#### `audit_logs`

用途：

- 记录管理员的后台操作审计日志

主要字段：

- `id`
- `actor_admin_id`
- `action`
- `target_type`
- `target_id`
- `payload_json`
- `created_at`

关系：

- `actor_admin_id -> admins.id`

相关行为：

- 列表查询时会联表补出管理员用户名与资源展示名
- `payload_json` 中会附带请求上下文，如方法、路径、Ray ID、IP、国家、colo、UA

## 7. 关系解释

### 7.1 强关系

- `admins -> audit_logs`
  - 一个管理员可以产生多条审计日志
- `users <-> nodes`
  - 通过 `user_node_map` 建立多对多关系
  - 订阅编译时会按用户绑定拉取可用节点
- `rule_sources -> rule_snapshots`
  - 一个规则源会产生多份快照
  - 编译订阅时只读取每个规则源的最新快照

### 7.2 逻辑关系但未显式建外键

- `templates` 当前没有直接连到 `users`
  - 模板是按 `target_type` 选默认模板，而不是按用户单独绑定
- `sync_logs` 当前没有强外键指向 `rule_sources`
  - 用 `source_type + source_id` 记录来源，方便未来扩展到更多同步对象
- `remote_subscription_sources`
  - 当前作为长期自动同步源独立存在
  - 会写入 `nodes` 和 `sync_logs`，但没有额外专用映射表
- `nodes.source_type + source_id`
  - 这对字段把“手动节点”和“远程节点”统一进一张表
  - 远程节点同步时会按来源 URL 规划更新 / 禁用逻辑

### 7.3 派生层不进入 ER 图

以下对象是“运行时派生物”，不是 D1 事实表，因此没有进入 ER 图：

- `SUB_CACHE` 中的 preview / subscription 缓存
- 管理员 Bearer token
- 订阅编译中间模型
- GitHub Actions 备份 artifact / `.enc` / `.sha256`

## 8. 索引与代码映射

### 8.1 当前索引

当前 migration 中已显式创建这些索引：

- `idx_users_status`
- `idx_users_expires_at`
- `idx_nodes_enabled`
- `idx_nodes_protocol`
- `idx_nodes_source`
- `idx_templates_target_enabled`
- `idx_templates_target_default`
- `idx_rule_sources_enabled`
- `idx_rule_snapshots_hash`（唯一）
- `idx_rule_snapshots_source_created`
- `idx_user_node_map_user_id`
- `idx_user_node_map_node_id`
- `idx_sync_logs_source_type`
- `idx_sync_logs_created_at`
- `idx_audit_logs_actor_admin_id`
- `idx_audit_logs_target`

这些索引当前主要服务于：

- 用户状态与过期筛选
- 节点按启用状态与来源读取
- 模板按目标类型与默认模板读取
- 规则源按启用状态同步
- 快照去重与按时间读取最新快照
- 用户/节点绑定查询
- 同步日志与审计日志列表倒序读取

### 8.2 数据到 API / Worker 的映射

当前共享类型与数据库表并不完全一一同名，但大体映射如下：

- `AdminRecord` ↔ `admins`
- `UserRecord` ↔ `users`
- `NodeRecord` ↔ `nodes`
- `TemplateRecord` ↔ `templates`
- `RuleSourceRecord` ↔ `rule_sources`
- `RemoteSubscriptionSourceRecord` ↔ `remote_subscription_sources`
- `RuleSnapshotRecord` ↔ `rule_snapshots`
- `UserNodeBinding` ↔ `user_node_map`
- `SyncLogRecord` ↔ `sync_logs`
- `AuditLogRecord` ↔ `audit_logs`

需要注意：

- `enabled` 在 D1 中是整数，在 TypeScript 侧会映射为布尔值
- `credentials_json` / `params_json` / `details_json` / `payload_json` 会在 repository 层解析为对象
- `AuditLogRecord` 在 repository / API 侧还会补出 `targetDisplayName` 与 `requestMeta`
- `templates.enabled` 会在 API 侧映射成 `status: enabled|disabled`

## 9. 模块到数据面的映射

可以按下面方式快速记忆当前分工：

- `apps/web`
  - 消费 `openapi.yaml` / `/api/*` 契约
  - 不直接接触 D1 表
- `apps/worker/src/repository.ts`
  - 最接近 D1 表结构
  - 负责把 SQLite 行映射成 `packages/shared` 中的 Record 类型
- `apps/worker/src/index.ts`
  - 负责路由编排、鉴权、日志、缓存失效、同步触发
- `apps/worker/src/cache.ts`
  - 负责 `SUB_CACHE` 清理与重建
- `apps/worker/src/sync.ts`
  - 负责规则源同步、快照去重、同步结果结构化输出
- `packages/core/src/compile.ts`
  - 负责把“用户 + 节点 + 模板 + 规则快照”编译成目标订阅

## 10. 当前最值得关注的边界

如果后续继续演进，建议优先守住这些边界：

1. **Worker 仍保持唯一入口**：避免把鉴权、订阅输出、同步逻辑分散到多个运行时
2. **D1 只存事实数据**：缓存、备份、临时同步产物不要反向变成事实来源
3. **`packages/shared` 先于接口扩展**：新增枚举、错误码、领域类型时，优先稳定共享层
4. **订阅编译与 HTTP 解耦**：让 `packages/core` 继续只关心输入输出，而不是请求上下文
5. **观测表与业务表分层**：`sync_logs` / `audit_logs` 只做追踪，不承担业务事实职责

## 11. 相关文档

- `docs/实施方案.md`
- `docs/API参考与接口约定.md`
- `openapi.yaml`
- `docs/部署指南.md`
