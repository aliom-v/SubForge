# SubForge

> 发布到公开 GitHub / GitLab 后，可把下面按钮里的 `https://github.com/aliom-v/SubForge` 替换成真实仓库地址：
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Faliom-v%2FSubForge)

SubForge 是一个部署在 Cloudflare 上的订阅分发与规则同步平台，当前仓库已具备可继续迭代的 MVP 基础。当前实现与目标方案之间的差异，统一记录在 `docs/已知问题与修复计划.md`：

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
- 管理员登录、会话校验、退出接口（支持服务端会话撤销）
- 用户管理（创建 / 编辑 / 删除 / 启停 / token 重置 / 节点绑定）
- 节点 CRUD
- 模板创建 / 更新 / 删除 / 默认模板切换
- 规则源创建 / 更新 / 删除 / 启停 / 手动同步
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
- 用户 / 节点 / 模板 / 规则源：创建 + 编辑 + 删除操作
- 用户节点绑定界面
- 规则源同步结果展示
- 同步日志与审计日志查看
- 订阅预览页面

### 同步与缓存

- 规则源支持 `text` / `yaml` / `json` 三种轻量解析
- 同步时会记录结构化 details：格式、耗时、上游状态、字节数、规则数、哈希、失败或跳过原因
- 同步时会做规则归一化、去重、内容哈希比较
- 内容未变化时会跳过快照更新
- 用户更新 / 绑定 / 删除变更时按用户失效缓存
- 节点更新 / 删除时按受影响用户失效缓存
- 模板创建 / 更新 / 删除 / 默认切换时按实际受影响的目标类型失效缓存
- 规则源启停 / 删除 / 内容同步变化时按全部用户失效缓存
- 公开订阅缓存命中前会重新校验 token 对应用户是否存在、是否启用、是否过期
- 用户节点绑定会显式拒绝缺失用户和未知节点 ID
- 当前节点写接口只接受 `manual` 类型；`remote` / `sourceId` 继续保留给后续节点源同步
- Web 节点页已支持 `credentials` / `params` JSON 手动录入，以及 `vless://` / `trojan://` / `vmess://` / `ss://` / `hysteria2://` / `hy2://` 分享链接导入和订阅 URL 远程预览
- Web 节点页已为 `vless` / `trojan` / `vmess` / `ss` / `hysteria2` 提供常见字段向导，并自动回填原始 JSON
- 默认模板只能指向 `enabled` 模板，避免“切换成功但实际不生效”的语义错觉
- 默认模板在被禁用时会自动清除默认标记，避免返回状态与后续生效模板再次分裂
- 节点更新支持通过 `credentials: null` / `params: null` 显式清空 metadata
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

## 节点使用提示

- 当前后台支持手动录入节点，以及 `vless://` / `trojan://` / `vmess://` / `ss://` / `hysteria2://` / `hy2://` 分享链接粘贴导入
- 当前后台也支持输入订阅 URL 做一次性远程抓取预览，再批量创建解析成功的节点
- 如果你拿到的是整段 Base64 包装订阅文本，现在也可以直接粘贴或通过订阅 URL 远程抓取后自动解包
- `vless` / `trojan` / `vmess` / `ss` / `hysteria2` 已支持常见字段的结构化字段向导
- `hysteria2://` / `hy2://` 当前优先覆盖常见单端点分享链接；多端口 authority 仍未覆盖
- 如果要生成真实可用节点，通常还需要补齐 `credentials` / `params`
- 创建节点后，还需要到“用户”页完成节点绑定，订阅输出才会包含该节点
- 订阅 URL 当前只做一次性预览导入，仍不支持远程节点源持续同步
- 详细流程见 `docs/节点管理与订阅使用说明.md`
- 可复制样例见 `docs/节点协议示例库.md`
- 链路排障见 `docs/导入成功但订阅没变化排障指南.md`

## 协议支持矩阵

如果你想快速判断“某协议现在到底支持到哪一层”，直接看：

- `docs/协议支持矩阵与落地计划.md`

这份文档会把以下层级拆开：

- 后台手动录入
- 分享链接导入
- 订阅 URL 远程预览导入
- 结构化协议向导
- 订阅输出链路

当前最稳定的主路径仍是：

- `vless`
- `trojan`
- `vmess`

`ss` 现在已把导入、远程预览、结构化向导和输出链路打通，但向导当前主要覆盖 `cipher/password/plugin`；`hysteria2` 也已补上常见字段向导与协议级校验，但单端点以外的复杂链接仍建议手动核对 JSON。

## Cloudflare 首次部署速记

如果你是直接在 Cloudflare Dashboard 里导入仓库，先记住这几个点：

1. 构建命令用 `npm run build`
2. 部署命令用 `npm run deploy`
3. 不要把 `npx wrangler versions upload` 当成首次部署命令；它只会上传 Worker 版本，不会执行远端 D1 migration
4. 首次打开页面如果看到 `VALIDATION_FAILED: D1_ERROR: no such table: admins`，说明远端 `DB` 还没完成 migration
5. 这时优先执行 `npm run db:migrations:apply`，或者去 Cloudflare 的 D1 SQL Console 手动执行 `migrations/` 里的 SQL
6. 排查时可执行 `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;`，至少应看到 `admins`、`users`、`nodes`、`templates`、`rule_sources`
7. 如果查询结果只有 `_cf_KV` 之类内部表，通常表示你选错了数据库，或者当前 D1 还没有应用 SubForge 的 migration
8. 当前文档默认先把主环境跑通；非生产分支预览不是必需步骤
9. 如果平台提供 branch preview / non-production build 开关，首次部署建议先不要开启；等主环境稳定后，再给 preview 单独配置 D1 / KV 更稳

部署后最小操作顺序：

1. 创建默认模板
2. 创建节点
3. 创建用户
4. 绑定节点到用户
5. 到预览页验证输出
6. 再用 `/s/:token/mihomo` 或 `/s/:token/singbox` 验证真实订阅

## 首次使用 5 分钟路径

如果你已经完成部署并能打开后台，建议直接按下面的 UI 顺序操作：

1. 打开 `模板`，先创建一个启用中的默认 `mihomo` 模板
2. 打开 `节点`，在“导入分享链接”或“导入订阅 URL”面板里导入节点
3. 如果你填的是订阅 URL，点击 `抓取并预览`；如果解析成功，页面会出现“批量创建 N 个节点”按钮
4. 如需微调字段，可点击 `载入首条到创建表单` 或表格里的 `载入表单`，再核对 `credentials` / `params`
5. 打开 `用户`，创建用户并完成节点绑定
6. 打开 `预览`，先验证后台输出，再访问 `/s/:token/mihomo` 或 `/s/:token/singbox`

如果你看到“节点创建成功”但订阅仍然没有变化，优先检查两件事：

- 是否已经把节点绑定到目标用户
- 是否已经存在启用中的默认模板

详细说明见：

- `docs/文档导航与阅读顺序.md`
- `docs/部署指南.md`
- `docs/节点管理与订阅使用说明.md`
- `docs/API参考与接口约定.md`
- `docs/节点字段字典.md`
- `docs/常见错误与返回语义.md`
- `docs/发布前检查清单.md`

## 本地开发

安装依赖：

```bash
npm install
```

执行 migration：

```bash
npm run db:migrations:apply:local
```

该命令会按顺序应用 `migrations/` 下的本地 D1 migration，包括 `002_admin_session_revocation.sql`。

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

也可以直接跑当前最小回归测试集合：

```bash
npm test
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

- 当前仓库默认走 **单 Worker + 静态资源** 部署，所有请求会先进 Worker，再由 Worker 把非 API 请求回退到 `apps/web/dist`。
- `wrangler.toml` 继续保持“无资源 ID”模式，并启用 `run_worker_first = true`，避免 `/api/*` 请求被 SPA `index.html` 误吞；这依赖 **`wrangler@4.45.0` 及以上** 自动 provision D1 / KV 绑定。
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
- 一键部署不等于零操作。真正决定能否跑通的是导入界面里是否使用了 `npm run deploy`，以及部署后远端 D1 是否已经完成 migration。
- 如果 Cloudflare 导入缓存了旧依赖，请重新触发一次安装，确保实际使用的是仓库里的 `wrangler@4.x`。
- 如果页面出现 `Unexpected token '<'`，通常表示 `/api/*` 返回了 HTML；当前仓库已改成 Worker-first 路由，重新部署后应恢复正常。
- 如果你后续拆成多个 Worker，再为每个 Worker 单独提供一个按钮会更稳。

## 文档入口

统一入口：

- `docs/文档导航与阅读顺序.md`

当前最常用文档：

- `docs/部署指南.md`
- `docs/节点管理与订阅使用说明.md`
- `docs/协议支持矩阵与落地计划.md`
- `docs/API参考与接口约定.md`
- `docs/节点字段字典.md`
- `docs/常见错误与返回语义.md`
- `docs/发布前检查清单.md`
- `docs/已知问题与修复计划.md`
- `docs/自动化验证与CI计划.md`

规划与长期说明：

- `项目介绍.md`
- `docs/实施方案.md`
- `.omx/plans/2026-03-07-subforge-roadmap.md`

近期批次历史：

- `docs/第二十二批自动化验证执行清单.md`
- `docs/第二十三批自动化验证执行清单.md`
- `docs/第二十四批自动化验证执行清单.md`
- `docs/第二十五批自动化验证执行清单.md`
- `docs/第二十六批自动化验证执行清单.md`

更早批次如需回看，直接看 `docs/` 目录即可，不再在 README 平铺完整历史清单。

## 下一步

- 决定是否继续补齐远程节点源同步与持久化建模
- 按 `docs/协议支持矩阵与落地计划.md` 里的顺序继续补协议能力
- 继续把测试从当前 create/update/delete/bind/logout 基线扩展到更完整错误矩阵与发布前回归
- 继续把 `docs/发布前检查清单.md` 里的关键项推进到更多自动化回归
- 继续增强规则源解析与同步错误展示
- 完善 CI / CD 与一键初始化流程
- 补更多审计字段与后台展示信息
