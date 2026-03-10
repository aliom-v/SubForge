# SubForge API 错误响应示例库

## 1. 这篇文档负责什么

这份文档专门沉淀可直接复制到联调、Mock、测试断言里的错误响应示例，重点回答：

- 常见 `4xx` 当前到底会返回什么 JSON 包裹
- `429` 除了 body 之外，通常还会带哪些头
- 当前仓库对 `5xx` 的真实现状是什么，哪些已经是应用层契约，哪些只是平台层现象

与其他文档的分工：

- `docs/API错误码与响应头说明.md`：解释协议语义、状态码、响应头含义
- `docs/API接口矩阵与OpenAPI草案.md`：解释哪些路由会出现这些错误
- `openapi.yaml`：提供机器可读契约与部分响应 example

## 2. 使用前提

- 下方 JSON 示例优先贴近当前 `apps/worker/src/index.ts` 和 `apps/worker/src/http.ts` 的真实实现
- 示例里的 token、时间、路径、限流数字仅用于说明结构，不代表固定值
- 当前 JSON 错误统一包裹为：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "request body must be valid JSON"
  }
}
```

- 如果你想同时看响应头，请配合 `docs/API错误码与响应头说明.md`

## 3. `400 Bad Request` 示例

### 3.1 请求体不是合法 JSON

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

### 3.2 目标类型不支持

适用接口：`GET /api/preview/:userId/:target`、`GET /s/:token/:target`

```http
HTTP/1.1 400 Bad Request
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "UNSUPPORTED_TARGET",
    "message": "unsupported subscription target"
  }
}
```

### 3.3 远程节点源返回的不是合法 JSON

适用接口：`POST /api/nodes/import/remote`

```http
HTTP/1.1 400 Bad Request
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "remote node source must return valid JSON",
    "details": {
      "sourceUrl": "https://example.com/nodes.json",
      "durationMs": 842
    }
  }
}
```

说明：实际 `details` 里还可能出现 `upstreamStatus`、`fetchedBytes`、`contentType` 等字段。

## 4. `401 Unauthorized` 示例

### 4.1 缺少 Bearer token

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

### 4.2 Bearer token 无效

```http
HTTP/1.1 401 Unauthorized
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "invalid admin session token"
  }
}
```

### 4.3 用户名或密码错误

适用接口：`POST /api/admin/login`

```http
HTTP/1.1 401 Unauthorized
content-type: application/json; charset=utf-8
x-subforge-rate-limit-scope: admin_login
x-subforge-rate-limit-limit: 5
x-subforge-rate-limit-remaining: 2
x-subforge-rate-limit-reset: 2026-03-09T12:34:56.000Z

{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "invalid username or password"
  }
}
```

## 5. `403 Forbidden` 示例

### 5.1 初始化已经完成，禁止重复 bootstrap

适用接口：`POST /api/setup/bootstrap`

```http
HTTP/1.1 403 Forbidden
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "setup has already been completed"
  }
}
```

### 5.2 管理员账号当前不可用

```http
HTTP/1.1 403 Forbidden
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "admin account is unavailable"
  }
}
```

## 6. `404 Not Found` 示例

### 6.1 路由不存在

```http
HTTP/1.1 404 Not Found
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "No route matches /api/not-exists"
  }
}
```

### 6.2 预览数据不存在

适用接口：`GET /api/preview/:userId/:target`

```http
HTTP/1.1 404 Not Found
content-type: application/json; charset=utf-8

{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "preview data not found"
  }
}
```

### 6.3 公开订阅 token 或模板上下文不存在

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

## 7. `429 Too Many Requests` 示例

### 7.1 管理员登录超限

```http
HTTP/1.1 429 Too Many Requests
content-type: application/json; charset=utf-8
x-subforge-rate-limit-scope: admin_login
x-subforge-rate-limit-limit: 5
x-subforge-rate-limit-remaining: 0
x-subforge-rate-limit-reset: 2026-03-09T12:40:00.000Z
retry-after: 600

{
  "ok": false,
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "too many login attempts, please retry later",
    "details": {
      "scope": "admin_login",
      "limit": 5,
      "remaining": 0,
      "retryAfterSec": 600,
      "resetAt": "2026-03-09T12:40:00.000Z",
      "current": 6
    }
  }
}
```

### 7.2 公开订阅请求超限

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

## 8. `5xx` 现状与说明

### 8.1 当前代码里的真实现状

根据当前 `apps/worker/src/index.ts`：

- Worker 主入口会捕获未识别异常
- 捕获后会统一返回 `createAppError('INTERNAL_ERROR')`
- 最终以 `500 Internal Server Error` 返回稳定的结构化 JSON

也就是说：当前仓库现在已经承诺一个最小应用层 JSON 5xx 契约。

### 8.2 应用层 `500` 示例

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

### 8.3 你仍然可能看到的其他 `5xx`

如果线上出现 `502` / `503` / `504`，更常见的来源通常是：

- Cloudflare 平台层
- 上游网络 / DNS / TLS 问题
- Worker 运行时之外的网关异常

这类响应：

- 不保证走 SubForge 的统一 JSON 包裹
- 不保证 `content-type` 为 `application/json`
- 更适合结合 Cloudflare 日志、Ray ID、平台监控一起排查

因此：

- `500 + INTERNAL_ERROR` 更接近 SubForge Worker 自身未归类异常
- `502` / `503` / `504` 更接近平台层或上游依赖异常

这类契约现在已经落到正式契约层，后续如果继续扩展 5xx 语义，建议同步更新：

- `packages/shared/src/errors.ts`
- `openapi.yaml`
- `docs/API错误码与响应头说明.md`
- 本文档

## 9. 相关文档

- `docs/API错误码与响应头说明.md`
- `docs/API接口矩阵与OpenAPI草案.md`
- `openapi.yaml`
- `docs/限流与安全策略.md`
