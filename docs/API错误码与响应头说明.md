# SubForge API 错误码与响应头说明

## 1. 这篇文档负责什么

这篇文档只保留“协议层”信息，重点回答：

- JSON API 的成功 / 失败包裹结构是什么
- `Authorization: Bearer <admin-session-token>` 的边界是什么
- 常见错误码、状态码、缓存头、限流头分别表示什么
- 联调或排障时应该先看哪些字段

不在这里重复展开的内容：

- 可直接复制到 Postman / 测试断言 / Mock Server 的错误样例：看 `docs/API错误响应示例库.md`
- 路由清单、哪些接口需要 Bearer、OpenAPI 入口：看 `docs/API接口矩阵与OpenAPI草案.md`
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

### 2.1 CORS 约定

当前 Worker 对 JSON / 文本响应都附带基础 CORS 头：

- `access-control-allow-origin: *`
- `access-control-allow-methods: GET,POST,PATCH,DELETE,OPTIONS`
- `access-control-allow-headers: content-type,authorization`

因此：

- 后台接口支持通过 `authorization` 头传 Bearer token
- 浏览器预检请求会由 `OPTIONS` 统一响应 `204`

## 3. 鉴权边界

### 3.1 需要 Bearer 的接口

除初始化和登录相关接口外，后台 API 统一要求：

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
| `500` / `502` / `503` / `504` | 不稳定 | 当前 Worker 代码没有稳定的结构化 JSON 5xx 契约 |

关于 `5xx` 需要单独强调三点：

- 当前 Worker 代码没有稳定的结构化 JSON 5xx 契约
- 未识别异常目前会被主入口 catch 后收敛成 `400 VALIDATION_FAILED`
- 真正看到的 `500` / `502` / `503` / `504` 更可能来自 Cloudflare 平台层或上游网关，格式不一定是 JSON

## 5. 响应头速查

| 场景 | 主要接口 | 重点响应头 | 备注 |
| --- | --- | --- | --- |
| 健康检查 | `GET /health` | 无专属头；主要看 `ok`、`service`、`env`、`cacheKeyExample`、`time` | 用于确认实例和环境 |
| 登录与管理员会话 | `POST /api/admin/login`、`GET /api/admin/me`、`POST /api/admin/logout` | `x-subforge-rate-limit-scope: admin_login`、`x-subforge-rate-limit-cleared: true`、`x-subforge-rate-limit-limit`、`x-subforge-rate-limit-remaining`、`x-subforge-rate-limit-reset`、`retry-after` | `POST /api/admin/logout` 当前返回 `{ loggedOut: true }` |
| 预览接口 | `GET /api/preview/:userId/:target` | `x-subforge-preview-cache: hit|miss`、`x-subforge-cache-key`、`x-subforge-cache-scope: preview` | 返回 JSON 包裹，`data` 中带 `cacheKey`、`mimeType`、`content`、`metadata` |
| 公开订阅接口 | `GET /s/:token/:target` | `x-subforge-cache: hit|miss`、`x-subforge-cache-key`、`x-subforge-cache-scope: subscription`、`x-subforge-rate-limit-scope: subscription`、`x-subforge-rate-limit-limit`、`x-subforge-rate-limit-remaining`、`x-subforge-rate-limit-reset`、`retry-after` | 返回订阅原文，频控检查发生在缓存读取前 |
| 其余后台资源接口 | `/api/users`、`/api/nodes`、`/api/templates`、`/api/rule-sources`、`/api/sync-logs`、`/api/audit-logs`、`/api/cache/rebuild` | 无固定专属头；重点看 HTTP 状态码、`error.code` 与结构化 `details` | 写操作通常会带来审计日志或缓存失效副作用 |

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

## 7. 当前边界

当前文档只覆盖协议层约定，因此：

- 不是 OpenAPI / Swagger 规范文件
- 不展开限流统计维度、默认阈值和调参建议
- 不枚举每个后台 CRUD 接口的完整字段 schema
- 重点放在错误码、鉴权、缓存头、限流头这些最容易影响联调的问题上

如果后续要开放给第三方更稳定对接，建议再补：

- 正式 OpenAPI 文档
- 更完整的请求 / 响应 JSON 示例
- 错误码与业务场景的矩阵表

## 8. 相关文档

- `docs/API错误响应示例库.md`
- `docs/API接口矩阵与OpenAPI草案.md`
- `docs/限流与安全策略.md`
- `docs/排障与常见问题.md`
- `docs/部署指南.md`
