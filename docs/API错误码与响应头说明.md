# SubForge API 错误码与响应头说明

## 1. 这篇文档负责什么

这篇文档只保留“协议层”信息，重点回答：

- JSON API 的成功 / 失败包裹结构是什么
- `Authorization: Bearer <admin-session-token>` 的边界是什么
- 常见错误码、状态码、缓存头、限流头和容易被误解的成功语义分别表示什么
- 联调或排障时应该先看哪些字段

不在这里重复展开的内容：

- 按资源分组的路由清单、请求示例与 OpenAPI 入口：看 `docs/API参考与接口约定.md`
- 限流统计维度、默认阈值和调参建议：看 `docs/限流与安全策略.md`

## 2. 响应形状

| 场景 | 形状 | 说明 |
| --- | --- | --- |
| JSON 成功 | `{ "ok": true, "data": ... }` | `content-type` 为 `application/json; charset=utf-8` |
| JSON 失败 | `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }` | `error.code` 为机器可读错误码，`error.message` 为可读描述 |
| 非 JSON 响应 | 订阅原文或静态资源 | `GET /s/:token/:target` 返回订阅内容；前端页面由 `ASSETS` 回退提供 |

当前有两类非 JSON 响应：

1. `GET /s/:token/:target`
   - `mihomo` 返回 `text/yaml; charset=utf-8`
   - `singbox` 返回 `application/json; charset=utf-8`
2. 静态资源与前端页面
   - 由 Worker 回退到 `ASSETS` 提供
   - 不走统一 JSON 包裹
   - 前端入口 HTML 壳（例如 `/`、`/dashboard`）会额外返回 `cache-control: no-store, max-age=0, must-revalidate`、`pragma: no-cache`、`expires: 0` 与 `x-subforge-asset-cache: html-no-store`
   - 这样做是为了避免发布后浏览器继续复用旧前端入口 HTML；带哈希的 JS / CSS / 图片资源仍可保留各自的静态资源缓存策略

### 2.1 CORS 约定

当前 Worker 对 JSON / 文本响应都附带基础 CORS 头：

- `access-control-allow-origin: *`
- `access-control-allow-methods: GET,POST,PATCH,DELETE,OPTIONS`
- `access-control-allow-headers: content-type,authorization`

因此：

- 管理接口支持通过 `authorization` 头传 Bearer token
- 浏览器预检请求会由 `OPTIONS` 统一响应 `204`

## 3. 鉴权边界

### 3.1 需要 Bearer 的接口

除初始化和登录相关接口外，管理 API 统一要求：

```http
Authorization: Bearer <admin-session-token>
```

当前前端默认会在这些接口上自动附带该头。

### 3.2 当前无需管理员鉴权的入口

- `GET /health`
- `GET /api/setup/status`
- `POST /api/setup/bootstrap`（仅首次初始化可用）
- `POST /api/admin/login`
- `GET /s/:token/:target`

### 3.3 常见鉴权失败

| 错误码 | 常见原因 |
| --- | --- |
| `UNAUTHORIZED` | 缺少 Bearer token、Bearer token 无效、用户名 / 密码错误 |
| `FORBIDDEN` | 初始化已完成却再次执行 bootstrap、管理员账号状态不可用 |

## 4. 常见错误码与状态码

当前共享错误码定义在 `packages/shared/src/errors.ts`，高频项包括：

- `INTERNAL_ERROR`
- `VALIDATION_FAILED`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `TOO_MANY_REQUESTS`
- `SUBSCRIPTION_USER_NOT_FOUND`
- `USER_DISABLED`
- `USER_EXPIRED`
- `NO_NODES_AVAILABLE`
- `TEMPLATE_NOT_FOUND`
- `UNSUPPORTED_TARGET`
- `RENDERER_NOT_FOUND`
- `TEMPLATE_TARGET_MISMATCH`

| 状态码 | 常见错误码 | 语义 |
| --- | --- | --- |
| `200 OK` | 无 | 普通 JSON 成功返回、管理员登录成功、预览成功 |
| `204 No Content` | 无 | CORS 预检 `OPTIONS` |
| `400 Bad Request` | `VALIDATION_FAILED`、`UNSUPPORTED_TARGET` | 参数校验失败、订阅编译失败、`target` 非法 |
| `401 Unauthorized` | `UNAUTHORIZED` | 登录失败、缺失或无效管理员 Bearer token |
| `403 Forbidden` | `FORBIDDEN` | 管理员账号不可用、初始化已完成后禁止重复 bootstrap |
| `404 Not Found` | `NOT_FOUND`、`SUBSCRIPTION_USER_NOT_FOUND` | 路由不存在、预览数据不存在、订阅 token / 模板上下文不存在 |
| `429 Too Many Requests` | `TOO_MANY_REQUESTS` | 登录或公开订阅超出频率限制 |
| `500 Internal Server Error` | `INTERNAL_ERROR` | Worker 捕获到未识别运行时异常，返回稳定的结构化 JSON 错误包裹 |
| `502` / `503` / `504` | 不稳定 | 更常见于 Cloudflare 平台层、网关或上游网络问题，不保证是 SubForge 的 JSON 包裹 |

关于 `5xx` 需要单独强调三点：

- 当前 Worker 对未识别异常已提供稳定的结构化 `500` JSON：`INTERNAL_ERROR`
- 这个 `500` 主要表示 Worker 内部未归类的运行时故障，而不是请求参数错误
- 真正看到的 `502` / `503` / `504` 仍更可能来自 Cloudflare 平台层或上游网关，格式不一定是 JSON

## 5. 响应头速查

| 场景 | 主要接口 | 重点响应头 | 备注 |
| --- | --- | --- | --- |
| 健康检查 | `GET /health` | 无专属头；主要看 `ok`、`service`、`env`、`cacheKeyExample`、`time` | 用于确认实例和环境 |
| 登录与管理员会话 | `POST /api/admin/login`、`GET /api/admin/me`、`POST /api/admin/logout` | `x-subforge-rate-limit-scope: admin_login`、`x-subforge-rate-limit-cleared: true`、`x-subforge-rate-limit-limit`、`x-subforge-rate-limit-remaining`、`x-subforge-rate-limit-reset`、`retry-after` | `POST /api/admin/logout` 当前会返回 `loggedOut`、`serverRevocation`、`mode` 与可选 `revokedAt` |
| 预览接口 | `GET /api/preview/:userId/:target` | `x-subforge-preview-cache: hit|miss`、`x-subforge-cache-key`、`x-subforge-cache-scope: preview` | 返回 JSON 包裹，`data` 中带 `cacheKey`、`mimeType`、`content`、`metadata` |
| 公开订阅接口 | `GET /s/:token/:target` | `x-subforge-cache: hit|miss`、`x-subforge-cache-key`、`x-subforge-cache-scope: subscription`、`x-subforge-rate-limit-scope: subscription`、`x-subforge-rate-limit-limit`、`x-subforge-rate-limit-remaining`、`x-subforge-rate-limit-reset`、`retry-after` | 返回订阅原文，频控检查发生在缓存读取前 |
| 其余管理资源接口 | `/api/users`、`/api/nodes`、`/api/templates`、`/api/rule-sources`、`/api/sync-logs`、`/api/audit-logs`、`/api/cache/rebuild` | 无固定专属头；重点看 HTTP 状态码、`error.code` 与结构化 `details` | 写操作通常会带来审计日志或缓存失效副作用 |

限流统计维度、默认阈值与调参建议见 `docs/限流与安全策略.md`。

## 6. 调试建议

### 6.1 推荐观察顺序

1. 先看 HTTP 状态码
2. 再看 `error.code`
3. 再看缓存头或限流头
4. 最后再看 `error.message` 与 `details`

这样更容易快速区分：

- 鉴权问题
- 参数问题
- 资源不存在
- 频控问题
- 订阅编译链路问题

### 6.2 按场景优先看这些字段

| 场景 | 优先看什么 |
| --- | --- |
| 预览问题 | `x-subforge-preview-cache`、`x-subforge-cache-key`、`x-subforge-cache-scope` |
| 公开订阅问题 | `x-subforge-cache`、`x-subforge-cache-key`、`x-subforge-rate-limit-remaining`、`x-subforge-rate-limit-reset`、`retry-after` |
| 登录问题 | HTTP 状态码是 `401` 还是 `429`、`error.code`、`x-subforge-rate-limit-remaining`、`retry-after` |

### 6.3 碰到问题先去看哪份文档

| 你遇到的问题 | 优先去看 | 原因 |
| --- | --- | --- |
| 首次部署后卡在 setup / 登录前就报错 | `docs/部署指南.md` | 这类问题大多是 migration、绑定或部署入口不对 |
| 不确定某个接口该怎么请求、成功返回长什么样 | `docs/API参考与接口约定.md` | 这里统一写了路由、包络和示例 |
| `ss` / `hysteria2` 字段校验失败 | `docs/节点字段字典.md` | 这里直接写了字段该落到 `credentials` 还是 `params` |
| “导入成功但托管订阅没变化” | `docs/节点管理与订阅使用说明.md` | 这里已经收进当前单用户模式的主路径与高频排查项 |
| 发布前想做一次最小验收 | `docs/发布前检查清单.md` | 这里按环境、绑定、预览、公开订阅和缓存顺序检查 |

## 7. 高频错误响应示例

下面保留最常见、最适合直接复制到联调或测试断言里的代表性示例。

### 7.1 请求体不是合法 JSON

适用接口：绝大多数 `POST` / `PATCH` JSON API

```http
HTTP/1.1 400 Bad Request
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "request body must be valid JSON"
  }
}
```

### 7.2 缺少 Bearer token

适用接口：除初始化 / 登录 / 公开订阅外的大多数 `/api/*`

```http
HTTP/1.1 401 Unauthorized
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "missing bearer token"
  }
}
```

### 7.3 公开订阅 token 或模板上下文不存在

适用接口：`GET /s/:token/:target`

```http
HTTP/1.1 404 Not Found
content-type: application/json; charset=utf-8
x-subforge-rate-limit-scope: subscription
x-subforge-rate-limit-limit: 60
x-subforge-rate-limit-remaining: 59
x-subforge-rate-limit-reset: 2026-03-09T12:35:00.000Z

{
  "ok": false,
  "error": {
    "code": "SUBSCRIPTION_USER_NOT_FOUND",
    "message": "subscription token or template not found"
  }
}
```

### 7.4 公开订阅请求超限

```http
HTTP/1.1 429 Too Many Requests
content-type: application/json; charset=utf-8
x-subforge-rate-limit-scope: subscription
x-subforge-rate-limit-limit: 60
x-subforge-rate-limit-remaining: 0
x-subforge-rate-limit-reset: 2026-03-09T12:35:00.000Z
retry-after: 60

{
  "ok": false,
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "subscription request rate limit exceeded",
    "details": {
      "scope": "subscription",
      "limit": 60,
      "remaining": 0,
      "retryAfterSec": 60,
      "resetAt": "2026-03-09T12:35:00.000Z",
      "current": 61
    }
  }
}
```

### 7.5 Worker 内部未归类异常

```http
HTTP/1.1 500 Internal Server Error
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "internal server error"
  }
}
```

### 7.6 仍然可能看到的其他 `5xx`

- `500 + INTERNAL_ERROR` 更接近 SubForge Worker 自身未归类异常
- `502` / `503` / `504` 更常见于 Cloudflare 平台层、网关或上游网络问题
- 这类平台层 `5xx` 不保证走统一 JSON 包裹，也不保证 `content-type` 为 `application/json`

## 8. 高频报错速查

### 8.1 请求体与鉴权类

- `request body must be valid JSON`
  - 请求体不是合法 JSON
- `request body must be a JSON object`
  - JSON 解析成功了，但顶层不是对象
- `missing bearer token`
  - 请求头里没有 `Authorization: Bearer ...`
- `invalid admin session token`
  - token 格式或签名不对
- `admin session has been revoked`
  - 已执行过 `POST /api/admin/logout`
- `admin account is unavailable`
  - 管理员被禁用，或管理员账号当前不可用

### 8.2 用户、节点与协议字段类

- `name is required`
  - 创建用户时没传 `name`
- `status must be active or disabled`
  - 用户状态值不在允许枚举里
- `expiresAt must be a valid datetime string`
  - 时间格式非法
- `nodeIds must be an array`
  - 绑定节点接口没有传数组
- `nodeIds must reference existing nodes: ...`
  - 绑定里包含不存在的节点 ID
- `name, protocol, server and port are required`
  - 创建节点缺少核心字段
- `port must be an integer between 1 and 65535`
  - 端口非法
- `sourceType must be manual or remote`
  - 来源类型不在允许枚举里
- `remote sourceType is not supported yet`
  - 普通节点创建 / 更新接口不允许手工把单条节点写成 `remote` 来源
- `sourceId is not supported for manual nodes`
  - 手动节点不接受来源 ID
- `credentials must be a JSON object or null`
- `params must be a JSON object or null`
  - metadata 结构不合法

### 8.3 协议字段与编译链路类

- `ss 节点需要 credentials.cipher 和 credentials.password`
- `ss 节点的 params.plugin 必须是非空字符串`
- `ss 节点暂不支持 params.plugin-opts / params.pluginOpts / params.plugins 这类复杂 plugin 字段，请继续直接核对原始 JSON`
- `hysteria2 节点需要 credentials.password`
- `hysteria2 节点的 params.sni 必须是非空字符串`
- `hysteria2 节点的 params.obfs 必须是非空字符串`
- `hysteria2 节点当前仅支持 params.obfs = "salamander"`
- `hysteria2 节点的 params["obfs-password"] 必须是非空字符串`
- `hysteria2 节点提供 params["obfs-password"] 时必须同时提供 params.obfs`
- `hysteria2 节点的 params.insecure 必须是布尔值`
- `hysteria2 节点的 params.pinSHA256 必须是字符串或非空字符串数组`
- `hysteria2 节点的 params.alpn 必须是字符串或非空字符串数组`
- `hysteria2 节点的 params.network 必须是非空字符串`
- `hysteria2 节点的 params.network 当前仅支持 "tcp" 或 "udp"`
- `hysteria2 节点的 params.mport 必须是非空字符串`
- `hysteria2 节点的 params["hop-interval"] 必须是非空字符串`
- `hysteria2 节点的 params.up / params.down / params.upmbps / params.downmbps 必须是非空字符串或数字`
- `targetType must be mihomo or singbox`
- `version must be a positive integer`
- `default template must be enabled`
- `template not found`
- `name, sourceUrl and format are required`
- `format must be text, yaml or json`
- `sourceUrl must be a valid http/https URL`
- `rule source not found`
- `unsupported subscription target`
- `preview data not found`
- `subscription token or template not found`
- `user is disabled`
- `user has expired`
- `no nodes available`

## 9. 容易误解的成功语义

### 9.1 `POST /api/node-import/preview`

成功只表示：

- 上游抓到了内容
- 解析器给出了候选节点和错误列表

它不表示：

- 节点已经创建
- 节点已经绑定
- 订阅一定会变化

### 9.2 `POST /api/users/:id/nodes`

成功表示绑定集合已被替换。

如果你预期的是“把一个新节点追加进去”，需要自己把旧节点 ID 一起传回去。

### 9.3 `POST /api/admin/logout`

成功后旧 token 会被服务端撤销。

因此“退出成功但本地还留着 token”不影响后续鉴权失败。

### 9.4 `GET /api/preview/:userId/:target`

这是管理员预览接口，会返回 JSON，并带：

- `x-subforge-preview-cache: hit | miss`

### 9.5 `GET /s/:token/:target`

这是公开订阅接口，会返回订阅文本，并带：

- `x-subforge-cache: hit | miss`

如果客户端说“订阅没变化”，不要只看节点创建是否成功，还要继续排查：

1. 是否绑定到正确用户
2. 是否使用了当前 token
3. 是否命中了旧缓存
4. 是否访问了正确 target

## 10. 当前边界

当前文档只覆盖协议层约定，因此：

- 不是 OpenAPI / Swagger 规范文件
- 不展开限流统计维度、默认阈值和调参建议
- 不枚举每个管理 CRUD 接口的完整字段 schema
- 重点放在错误码、鉴权、缓存头、限流头这些最容易影响联调的问题上

如果后续要开放给第三方更稳定对接，建议再补：

- 正式 OpenAPI 文档
- 更完整的请求 / 响应 JSON 示例
- 错误码与业务场景的矩阵表

## 11. 相关文档

- `docs/API参考与接口约定.md`
- `docs/节点字段字典.md`
- `docs/节点协议示例库.md`
- `docs/节点管理与订阅使用说明.md`
- `docs/限流与安全策略.md`
- `docs/排障与常见问题.md`
- `docs/部署指南.md`
