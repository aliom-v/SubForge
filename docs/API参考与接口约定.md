# SubForge API参考与接口约定

## 1. 文档目的

本文档用于给当前仓库提供一份“够用且写实”的 API 参考，重点回答三类问题：

1. 当前有哪些稳定可用的接口
2. 成功和失败分别按什么包络返回
3. 哪些接口语义最容易被误解

如果你只是自己部署、自己使用，这篇通常不需要看；它主要用于开发联调和接口排查。

如果你是第一次接手项目，建议先看：

- `docs/INDEX.md`

如果你还要查节点字段具体落点，再看：

- `docs/节点字段字典.md`

如果你主要在排查错误码和状态码，再看：

- `docs/API错误码与响应头说明.md`

---

## 2. 统一约定

### 2.1 管理端 JSON 包络

大多数 `/api/*` 接口都返回 JSON，成功和失败统一为：

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "validation failed"
  }
}
```

### 2.2 公开订阅不是 JSON

`GET /s/:token/:target` 返回的是订阅纯文本，不走上面的 `data` 包络。

只有在失败时，才会返回 JSON 错误包络。

### 2.3 鉴权方式

除了以下三个接口外，其余 `/api/*` 都要求管理员 Bearer token：

- `GET /api/setup/status`
- `POST /api/setup/bootstrap`
- `POST /api/admin/login`

请求头格式：

```text
Authorization: Bearer <token>
```

### 2.4 常用枚举

- `target`: `mihomo` | `singbox`
- `user.status`: `active` | `disabled`
- `admin.status`: `active` | `disabled`
- `ruleSource.format`: `text` | `yaml` | `json`
- `node.sourceType`: 普通创建 / 更新接口当前只允许 `manual`；`remote` 仅由远程节点源手动同步链路写入

### 2.5 按资源分组的状态码速查

| 资源 | 常见状态码 | 最常见触发 |
| --- | --- | --- |
| `setup` / `admin` | `200` / `201` / `400` / `401` / `403` | 首次安装、登录、token 撤销、管理员不可用 |
| `users` | `200` / `201` / `400` / `404` | 创建、更新时间格式非法、绑定未知节点、用户不存在 |
| `node-import` / `nodes` | `200` / `201` / `400` / `404` | 远程预览成功、metadata 校验失败、节点不存在 |
| `templates` | `200` / `201` / `400` / `404` | 默认模板必须启用、模板不存在 |
| `rule-sources` | `200` / `201` / `400` / `404` | URL/format 非法、规则源不存在 |
| `preview` / `subscription` | `200` / `400` / `404` | target 非法、用户禁用/过期、模板或 token 缺失 |

### 2.6 正式 OpenAPI 与契约入口

- `openapi.yaml`：机器可读的正式契约，适合 Swagger / Redoc / 代码生成
- `npm run test:contract`：检查 `openapi.yaml`、公开鉴权边界与前端 API 路由清单是否仍一致
- 本文档：保留给人直接阅读的稳定接口参考，不再额外拆一份“接口矩阵”说明

---

## 3. 基础接口

### 3.1 健康检查

- `GET /health`

返回当前服务信息、环境名和订阅 cache key 示例，适合用来确认 Worker 是否已经正常起来。

### 3.2 首次安装

- `GET /api/setup/status`
  - 无需鉴权
  - 返回：
    - `initialized`
    - `adminCount`

- `POST /api/setup/bootstrap`
  - 无需鉴权
  - 请求体：

```json
{
  "username": "admin",
  "password": "your-password"
}
```

  - 约束：
    - `username` 至少 3 个字符
    - `password` 至少 8 个字符
    - 仅在还没有管理员时允许执行
  - 成功返回 `201`
  - 返回：
    - `initialized`
    - `token`
    - `admin`

### 3.3 管理员登录与会话

- `POST /api/admin/login`
  - 请求体：

```json
{
  "username": "admin",
  "password": "your-password"
}
```

  - 返回：
    - `token`
    - `admin`

- `GET /api/admin/me`
  - 需要 Bearer token
  - 返回当前管理员会话信息

- `POST /api/admin/logout`
  - 需要 Bearer token
  - 返回：
    - `loggedOut`
    - `serverRevocation`
    - `mode`
    - `revokedAt`
  - 当前语义不是“前端自己删 token 就算退出”，而是服务端也会写入撤销时间；旧 token 后续访问会直接失效

---

## 4. 管理台资源接口

### 4.1 用户

- `GET /api/users`
  - 返回用户列表

- `POST /api/users`
  - 请求体：

```json
{
  "name": "Demo Alice",
  "remark": "optional",
  "expiresAt": "2026-12-31T00:00:00.000Z"
}
```

  - `remark`、`expiresAt` 可省略

- `PATCH /api/users/:id`
  - 可更新：
    - `name`
    - `status`
    - `remark`
    - `expiresAt`

- `DELETE /api/users/:id`
  - 返回：
    - `deleted: true`
    - `userId`

- `POST /api/users/:id/reset-token`
  - 重置订阅 token
  - 返回更新后的 `UserRecord`

- `GET /api/users/:id/nodes`
  - 返回当前用户的节点绑定列表

- `POST /api/users/:id/nodes`
  - 请求体：

```json
{
  "nodeIds": ["node-1", "node-2"]
}
```

  - 当前语义是整组替换，不是增量追加
  - 返回：
    - `userId`
    - `nodeIds`

### 4.2 节点远程预览导入

- `POST /api/node-import/preview`
  - 请求体：

```json
{
  "sourceUrl": "https://example.com/sub.txt"
}
```

  - 约束：
    - 只允许 `http://` / `https://`
  - 返回：
    - `sourceUrl`
    - `upstreamStatus`
    - `durationMs`
    - `fetchedBytes`
    - `lineCount`
    - `contentEncoding`
    - `nodes`
    - `errors`
  - 这只是一次性预览，不会创建节点、不持久化远程来源、也不等于远程节点源同步

### 4.3 节点

- `GET /api/nodes`
  - 返回节点列表

- `POST /api/nodes`
  - 请求体最小字段：

```json
{
  "name": "hk-hy2",
  "protocol": "hysteria2",
  "server": "node.example.com",
  "port": 443,
  "credentials": {
    "password": "replace-me"
  },
  "params": {
    "sni": "cdn.example.com"
  }
}
```

  - 必填：
    - `name`
    - `protocol`
    - `server`
    - `port`
  - 当前限制：
    - `port` 必须在 `1..65535`
    - `sourceType=remote` 还不支持
    - `sourceId` 还不支持手动节点写入
    - `credentials` / `params` 必须是对象或 `null`

- `PATCH /api/nodes/:id`
  - 可更新：
    - `name`
    - `protocol`
    - `server`
    - `port`
    - `enabled`
    - `credentials`
    - `params`
  - 允许通过 `credentials: null` / `params: null` 显式清空 metadata

- `DELETE /api/nodes/:id`
  - 返回：
    - `deleted: true`
    - `nodeId`

### 4.4 模板

- `GET /api/templates`
  - 返回模板列表

- `POST /api/templates`
  - 请求体：

```json
{
  "name": "default-mihomo",
  "targetType": "mihomo",
  "content": "{{proxies}}",
  "isDefault": true
}
```

  - 约束：
    - `targetType` 只能是 `mihomo` 或 `singbox`
    - `version` 如果传入，必须是正整数
    - 默认模板必须是启用状态

- `PATCH /api/templates/:id`
  - 可更新：
    - `name`
    - `content`
    - `version`
    - `enabled`
    - `isDefault`

- `POST /api/templates/:id/set-default`
  - 把某个模板设为默认模板
  - disabled 模板不能设为默认

- `DELETE /api/templates/:id`
  - 返回：
    - `deleted: true`
    - `templateId`

### 4.5 规则源

- `GET /api/rule-sources`
  - 返回规则源列表

- `POST /api/rule-sources`
  - 请求体：

```json
{
  "name": "ACL4SSR",
  "sourceUrl": "https://example.com/rules.yaml",
  "format": "yaml"
}
```

  - 约束：
    - `format` 只能是 `text` / `yaml` / `json`
    - `sourceUrl` 必须是合法 `http/https` URL

- `PATCH /api/rule-sources/:id`
  - 可更新：
    - `name`
    - `sourceUrl`
    - `format`
    - `enabled`

- `POST /api/rule-sources/:id/sync`
  - 立即同步一个规则源
  - 返回：
    - `sourceId`
    - `sourceName`
    - `status`
    - `message`
    - `changed`
    - `ruleCount`
    - `details`

- `DELETE /api/rule-sources/:id`
  - 返回：
    - `deleted: true`
    - `ruleSourceId`

### 4.6 日志

- `GET /api/sync-logs`
  - 返回同步日志列表

- `GET /api/audit-logs`
  - 返回审计日志列表

---

## 5. 预览与公开订阅

### 5.1 后台预览

- `GET /api/preview/:userId/:target`
  - 需要 Bearer token
  - 返回：
    - `cacheKey`
    - `mimeType`
    - `content`
    - `metadata`
  - 响应头：
    - `x-subforge-preview-cache: hit | miss`
    - `x-subforge-cache-key`
    - `x-subforge-cache-scope: preview`

### 5.2 公开订阅

- `GET /s/:token/:target`
  - 不需要管理员鉴权
  - 成功时直接返回订阅文本
  - 响应头：
    - `x-subforge-cache: hit | miss`
    - `x-subforge-cache-key`
    - `x-subforge-cache-scope: subscription`

如果你在这里拿到的是错误 JSON，优先检查：

1. token 是否对应有效用户
2. 用户是否已禁用或过期
3. 是否存在启用中的默认模板
4. 用户是否真的绑定了可用节点

---

## 6. 完整请求 / 响应示例

为便于阅读，下面的示例省略了部分 `id`、时间戳和长文本细节，但字段结构保持与当前接口一致。

### 6.1 `POST /api/setup/bootstrap`

请求：

```http
POST /api/setup/bootstrap
Content-Type: application/json

{
  "username": "admin",
  "password": "demo-password"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "initialized": true,
    "token": "eyJhbGciOi...",
    "admin": {
      "id": "admin-1",
      "username": "admin",
      "role": "admin",
      "status": "active"
    }
  }
}
```

### 6.2 `POST /api/node-import/preview`

请求：

```http
POST /api/node-import/preview
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "sourceUrl": "https://example.com/sub.txt"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "sourceUrl": "https://example.com/sub.txt",
    "upstreamStatus": 200,
    "durationMs": 143,
    "fetchedBytes": 512,
    "lineCount": 2,
    "contentEncoding": "plain_text",
    "nodes": [
      {
        "name": "hk-hy2",
        "protocol": "hysteria2",
        "server": "node.example.com",
        "port": 443,
        "credentials": {
          "password": "replace-me"
        },
        "params": {
          "sni": "cdn.example.com"
        },
        "source": "hysteria2://replace-me@node.example.com:443?sni=cdn.example.com#hk-hy2"
      }
    ],
    "errors": []
  }
}
```

### 6.3 `POST /api/nodes`

请求：

```http
POST /api/nodes
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "name": "hk-hy2",
  "protocol": "hysteria2",
  "server": "node.example.com",
  "port": 443,
  "credentials": {
    "password": "replace-me"
  },
  "params": {
    "sni": "cdn.example.com",
    "obfs": "salamander"
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "id": "node-1",
    "name": "hk-hy2",
    "protocol": "hysteria2",
    "server": "node.example.com",
    "port": 443,
    "sourceType": "manual",
    "enabled": true,
    "credentials": {
      "password": "replace-me"
    },
    "params": {
      "sni": "cdn.example.com",
      "obfs": "salamander"
    }
  }
}
```

### 6.4 `GET /s/:token/:target`

请求：

```http
GET /s/demo-token/mihomo
```

成功响应示意：

```text
proxies:
  - name: hk-hy2
    type: hysteria2
    server: node.example.com
    port: 443
```

当前语义：

- 成功时返回纯文本
- 响应头里可观察 `x-subforge-cache: hit | miss`
- 如果这里返回的是 HTML 或错误 JSON，优先去查部署、token、模板和绑定链路

---

## 7. 当前最容易误解的接口语义

### 7.1 `/api/node-import/preview` 只预览，不创建

它会拉取上游文本、解析分享链接并返回候选节点，但不会自动落库。

### 7.2 `/api/users/:id/nodes` 是替换绑定，不是追加绑定

如果你只传一个新的 `nodeId`，旧绑定会被整组替换掉。

### 7.3 `/api/admin/logout` 是服务端撤销，不是单纯前端退出

返回成功后，旧 token 再访问受保护接口会返回 `401`。

### 7.4 `/s/:token/:target` 成功时是纯文本

这条路由不是给后台页面消费的 JSON API，而是给客户端直接拉订阅。

### 7.5 `hy2` 会统一按 `hysteria2` 处理

无论是导入还是字段校验，`hy2` 当前都会归一化到 `hysteria2`。

---

## 8. OpenAPI 与契约入口

- `openapi.yaml`：正式 OpenAPI 规范，覆盖 `/health`、`/api/*`、`/s/{token}/{target}` 与关键 request / response examples
- `npm run test:contract`：纯 Node.js 的契约漂移检查，校验公开接口鉴权边界、关键 schema 与前端 API 路径
- `docs/API错误码与响应头说明.md`：查 Bearer、错误码、缓存头、限流头、高频报错和成功语义误区

---

## 9. 配套文档

- `docs/节点字段字典.md`：查节点字段、metadata 和协议映射
- `docs/API错误码与响应头说明.md`：查状态码、错误码、高频报错和成功语义误区
- `docs/节点协议示例库.md`：查可复制样例
- `docs/节点管理与订阅使用说明.md`：查导入到托管输出的主链路和排障
- `docs/发布前检查清单.md`：查部署完成后的最小验收顺序
