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

- 当前仓库默认走 **单 Worker + 静态资源** 部署，Worker 会直接托管 `apps/web/dist`。
- `wrangler.toml` 继续保持“无资源 ID”模式，但这依赖 **`wrangler@4.45.0` 及以上** 在部署时自动 provision D1 / KV 绑定；仓库已升级到该版本区间。
- 根 `package.json` 里的 `build` 与 `deploy` 已拆开：`npm run build` 只构建前端，`npm run deploy` 负责远端 migration + Worker 发布，更适合 Cloudflare UI / Git 导入。
- `package.json` 中保留了 `cloudflare.bindings` 描述，Cloudflare 导入表单会显示绑定用途说明。
- 首次部署后可直接通过后台安装向导创建管理员，无需先跑 `seed:admin`。
- 若你仍想单独托管前端，也可以把 `apps/web` 部署到 Pages，但这不再是必需步骤。

### 首次 UI 部署步骤

1. 打开仓库首页的 `Deploy to Cloudflare` 按钮。
2. 在 Cloudflare 导入界面确认仓库 URL 正确，并使用仓库根目录作为应用根目录。
3. 确认构建命令为 `npm run build`，部署命令为 `npm run deploy`；如果 Cloudflare 没自动填出这两个值，可手动填写。
4. 在绑定/变量界面确认以下运行时配置：
   - `DB`：D1
   - `SUB_CACHE`：KV
   - `ADMIN_JWT_SECRET`：运行时 Secret
   - 可选变量：`APP_ENV`、`SUBSCRIPTION_CACHE_TTL`、`PREVIEW_CACHE_TTL`、`SYNC_HTTP_TIMEOUT_MS`
5. 首次部署时，Cloudflare 会基于仓库中的 `wrangler@4.x` 自动 provision 缺失的 D1 / KV 绑定；如果你的账号环境没有自动创建出来，再回到 Dashboard 手动补绑 `DB` / `SUB_CACHE` 即可。
6. 完成导入后，等待 Cloudflare 首次构建并部署 Worker。
7. 打开 Worker 域名，进入后台首次安装向导，创建首个管理员。
8. 如果需要演示数据，再执行 `npm run seed:demo` 并导入到 D1。

### 按钮使用提示

- 当前按钮面向 **公开 GitHub 仓库**，私有仓库或非 GitHub/GitLab 源通常不能直接给他人一键部署。
- 当前项目虽然是 monorepo，但 Worker 应用入口位于仓库根目录，按钮应直接指向仓库根，不要再额外传子目录。
- 如果 Cloudflare 导入缓存了旧依赖，请重新触发一次安装，确保实际使用的是仓库里的 `wrangler@4.x`。
- 如果你后续拆成多个 Worker，再为每个 Worker 单独提供一个按钮会更稳。

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
