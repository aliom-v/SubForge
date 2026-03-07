# SubForge

> 发布到公开 GitHub / GitLab 后，可把下面按钮里的 `<YOUR_PUBLIC_REPO_URL>` 替换成真实仓库地址：
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<YOUR_PUBLIC_REPO_URL>)

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
docs/          实施与部署文档
scripts/       初始化脚本
```

## 当前已实现

### 后端

- 首次安装状态检查与初始化管理员 API
- 管理员登录、会话校验、退出
- 用户 CRUD（含 token 重置）
- 节点 CRUD
- 模板创建 / 更新 / 默认模板切换
- 规则源创建 / 更新 / 手动同步
- 用户与节点绑定管理
- `/api/preview/:userId/:target` 预览接口
- `/s/:token/:target` 公开订阅接口
- 同步日志与审计日志接口
- 审计日志联表管理员名称并附带请求上下文
- Cron 自动同步启用规则源

### 前端

- 首次安装向导（创建首个管理员）
- 单页式管理后台
- 后台前端可随 Worker 一起部署在同一域名下
- 用户 / 节点 / 模板 / 规则源：创建 + 编辑表单
- 用户节点绑定界面
- 规则源同步结果展示
- 同步日志与审计日志查看
- 订阅预览页面

### 同步与缓存

- 规则源支持 `text` / `yaml` / `json` 三种轻量解析
- 同步时会记录结构化 details：格式、耗时、上游状态、规则数、哈希、跳过原因
- 同步时会做规则归一化、去重、内容哈希比较
- 内容未变化时会跳过快照更新
- 用户更新 / 绑定变更时按用户失效缓存
- 节点更新 / 删除时按受影响用户失效缓存
- 模板变更时按实际受影响的目标类型失效缓存
- 预览缓存与公开订阅缓存分离，TTL 可独立配置
- API 输入增加 URL / 日期 / 端口 / 枚举值校验，前端表单同步做基础校验

## 初始化管理员

优先推荐直接打开后台完成首次安装向导。

如果需要手动导入管理员，也可以继续使用 seed 脚本：

生成管理员 SQL：

```bash
npm run seed:admin -- admin your-password
```

导入本地 D1：

```bash
npm run seed:admin -- admin your-password | npx wrangler d1 execute subforge --local --file=-
```

## 导入 Demo 数据

```bash
npm run seed:demo | npx wrangler d1 execute subforge --local --file=-
```

脚本会输出 demo 用户 token，可直接测试：

- `/s/:token/mihomo`
- `/s/:token/singbox`

## 本地开发

安装依赖：

```bash
npm install
```

执行 migration：

```bash
npx wrangler d1 execute subforge --local --file=migrations/001_init.sql
```

启动 Worker：

```bash
npm run dev:worker
```

启动 Web：

```bash
npm run dev:web
```

默认本地地址：

- Worker: `http://127.0.0.1:8787`
- Web: `http://127.0.0.1:5173`

本地开发时，Vite 会把 `/api`、`/s`、`/health` 自动代理到 Worker，因此默认可直接走同域请求。

可先做一轮零依赖 smoke 校验：

```bash
npm run test:smoke
```

如需显式覆盖前端 API 地址，可设置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
```

## 关键环境变量

- `ADMIN_JWT_SECRET`：管理员会话签名密钥
- `SUBSCRIPTION_CACHE_TTL`：公开订阅缓存 TTL，默认 `1800`
- `PREVIEW_CACHE_TTL`：预览缓存 TTL，默认 `120`
- `SYNC_HTTP_TIMEOUT_MS`：规则源拉取超时，默认 `10000`
- `VITE_API_BASE_URL`：前端 API 基地址

## Cloudflare UI / Git 部署

- `wrangler.toml` 已改成更适合 Dashboard / Git 导入的默认绑定配置，省略了资源 ID，由 Cloudflare 在导入时自动补齐。
- Worker 已配置静态资源目录为 `apps/web/dist`，导入后会把管理后台一并托管。
- 根 `package.json` 已增加 `deploy` / `db:migrations:apply`，Deploy to Cloudflare 会自动预填这些命令。
- 首次部署后可直接通过后台安装向导创建管理员，无需先跑 `seed:admin`。
- 若你仍想单独托管前端，也可以把 `apps/web` 部署到 Pages，但这不再是必需步骤。

## 文档入口

- `项目介绍.md`
- `docs/实施方案.md`
- `docs/部署指南.md`
- `.omx/plans/2026-03-07-subforge-roadmap.md`

## 下一步

- 继续增强规则源解析与同步错误详情
- 补更多审计字段与后台展示信息
- 完善 CI / CD 与一键初始化流程
- 增加更细的前端交互反馈与表单校验
