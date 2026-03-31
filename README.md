# SubForge

> 发布到公开 GitHub / GitLab 后，可把下面按钮里的 `https://github.com/aliom-v/SubForge` 替换成真实仓库地址：
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Faliom-v%2FSubForge)

SubForge 是一个部署在 Cloudflare 上的单用户托管订阅工具，当前主目标很明确：

- 绑定你自己的域名
- 导入节点文本、上游订阅 URL 或完整配置
- 按当前启用节点统一生成可被 Mihomo / sing-box 客户端拉取的托管 URL
- 不需要传统常驻服务器

当前仓库内部仍保留用户、模板、规则集、缓存这些底层对象来完成订阅编译，但在单用户托管模式下，这些对象默认都由系统自动维护，不要求手动管理。

## 目录结构

```text
apps/
  web/         管理后台
  worker/      API / 订阅输出 / Cron
packages/
  core/        订阅编译核心
  shared/      共享类型 / 错误码 / cache key
migrations/    D1 migration
docs/          实施、部署与安全文档
scripts/       初始化脚本
```

## 当前主流程

- 首次安装向导、管理员登录、同域部署
- 节点页只保留三个主入口：`节点文本导入`、`订阅 URL 解析`、`导入完整配置`
- 节点页支持 JSON 批量导入和完整配置导入；更通用的远程 JSON 节点源同步仅保留为后台高级接口
- 支持 `vless` / `trojan` / `vmess` / `ss` / `ssr` / `tuic` / `hysteria2` 分享链接、Base64 订阅文本、JSON 节点清单、完整 Mihomo / Clash YAML、完整 sing-box JSON
- 导入后可按当前启用节点统一生成 `/s/:token/mihomo` 与 `/s/:token/singbox`
- 上游订阅 URL 现在可以保存为自动同步源，并按当前 Cron 配置定时同步
- 当前托管 URL、节点列表、链式代理拓扑都保留在主界面
- Cloudflare Worker + D1 + KV 提供订阅编译、缓存、限流和审计能力

## 当前边界

- 当前公开输出只支持 `mihomo` 与 `singbox`
- 当前不是完整配置编辑器
- 多用户、计费、复杂权限、规则集/模板手工运营都不是当前主路径
- 规则源支持 `text` / `yaml` / `json`，但这条链路当前只是保留能力，不是单用户模式的首要使用方式
- 更通用的远程 JSON 节点源同步仍只保留为高级手动接口，不单独建模为可定时同步对象
- 规则源同步和更多后台对象仍保留在代码与数据层，但不再作为单用户模式的首要使用方式

## 快速开始

1. 安装依赖：`npm ci`
2. 执行一键初始化：`npm run init:local`
3. 启动 Worker：`npm run dev:worker`
4. 启动 Web：`npm run dev:web`
5. 打开后台，完成首次安装向导或使用已导入的管理员登录

运行时建议：

- 仓库通过 `.nvmrc` 与 `.node-version` 固定 `Node.js 20`
- 当前支持范围为 `>=20 <25`
- 如本机使用 `Node.js 25+`，`npm ci` 会在前置检查阶段直接失败，避免继续掉进 `sharp` 等原生依赖的隐晦构建错误
- 如本机已安装全局 `libvips >= 8.17.3`（例如部分 Arch Linux 环境），`sharp` 会自动切到源码构建；仓库已显式声明 `node-addon-api` 与 `node-gyp`，避免 `npm ci` 卡死在缺少 JS 构建依赖

默认本地地址：

- Worker：`http://127.0.0.1:8787`
- Web：`http://127.0.0.1:5173`

本地开发时，Vite 会把 `/api`、`/s`、`/health` 自动代理到 Worker，因此默认可直接走同域请求。

如需显式覆盖前端 API 地址，可设置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
```

更完整的本地与 Cloudflare 部署步骤请看 `docs/部署指南.md`。

如需在初始化时一并导入管理员和 demo 数据，可执行：

```bash
npm run init:local -- --admin-user admin --admin-password your-password --with-demo
```

如果你更想按旧方式手动执行 migration，也可以继续使用：

```bash
npx wrangler d1 migrations apply DB --local --config ./wrangler.toml
```

安装依赖后，如需补一轮更真实的核心回归校验，可执行：

```bash
npm run test:unit
```

## 初始化管理员

优先推荐直接打开后台完成首次安装向导。

如果想把 migration、管理员导入和 demo 数据导入收敛为一条命令，优先使用：

```bash
npm run init:local -- --admin-user admin --admin-password your-password --with-demo
```

如果需要手动导入管理员，也可以继续使用 seed 脚本：

```bash
npm run seed:admin -- admin your-password
npm run seed:admin -- admin your-password | npx wrangler d1 execute subforge --local --file=-
```

## 导入 Demo 数据

```bash
npm run seed:demo | npx wrangler d1 execute subforge --local --file=-
```

脚本会输出 demo 用户 token，可直接测试：

- `/s/:token/mihomo`
- `/s/:token/singbox`

## 个人使用的唯一主流程

如果你的需求只是：

- 导入节点文本
- 或导入远程订阅 URL
- 或导入完整 Mihomo / sing-box 配置
- 然后生成一份可托管的订阅 URL

现在优先直接用后台 `节点` 页的三个主入口：

- `节点文本导入`
- `订阅 URL 解析`
- `导入完整配置`

推荐顺序：

1. 先通过三种入口之一把节点导入到节点列表；如果是上游订阅 URL 且需要长期跟随更新，就走 `保存为自动同步源`
2. 再调整节点启用状态、节点内容或链式代理关系
3. 点击 `使用当前启用节点生成托管 URL`
4. 把生成出的 URL 填到客户端里使用

语义要区分清楚：

- `订阅 URL -> 抓取并导入节点` 是一次性抓取并导入，写入的是当前节点列表，不会把这个 URL 自动保存成长期同步任务
- `订阅 URL -> 保存为自动同步源` 才会把上游地址保存成自动同步源，并按 Worker Cron 定时刷新对应节点

系统会自动维护托管身份和输出骨架。你不需要先手动创建用户、模板或规则集。

当前后台默认已经收成个人极简模式：

- `节点` 页仍是默认主入口
- 托管 URL 展示、链式代理拓扑与节点列表仍保留
- 用户、模板、绑定与预览这些底层对象仍由系统自动维护，但前端默认不再单独暴露对应后台页

## 关键环境变量

- `ADMIN_JWT_SECRET`：管理员会话签名密钥
- `ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC`：管理员登录失败限流窗口秒数，默认 `600`
- `ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`：管理员登录失败窗口内最大尝试次数，默认 `5`
- `SUBSCRIPTION_CACHE_TTL`：公开订阅缓存 TTL，默认 `1800`
- `SUBSCRIPTION_RATE_LIMIT_WINDOW_SEC`：公开订阅频控窗口秒数，默认 `60`
- `SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS`：公开订阅窗口内最大请求数，默认 `60`
- `PREVIEW_CACHE_TTL`：预览缓存 TTL，默认 `120`
- `SYNC_HTTP_TIMEOUT_MS`：远程抓取超时，默认 `10000`
- `VITE_API_BASE_URL`：前端 API 基地址

## 部署摘要

- 当前仓库默认走 **单 Worker + 静态资源** 部署，所有请求会先进 Worker，再由 Worker 把非 API 请求回退到 `apps/web/dist`
- `wrangler.toml` 显式维护 production / staging 的 D1 与 KV 资源 ID，并启用 `run_worker_first = true`；仓库当前随依赖安装 `wrangler@4.77.0`，这样 GitHub Actions 与本地 CLI 在执行远端 migration / deploy 时能稳定定位目标资源
- 根 `package.json` 中 `npm run build` 只构建前端；`npm run deploy` / `npm run deploy:staging` 与直接执行 `deploy:worker*` 前都会先刷新 `apps/web/dist`，避免把旧后台静态资源一并发到 Cloudflare
- 如需把远端构建、部署和首轮数据初始化收敛成单条命令，可执行 `npm run init:remote -- --admin-user admin --admin-password your-password`
- 首次部署后可直接通过后台首次安装向导创建管理员，无需先跑 `seed:admin`
- 如果需要完整的 Cloudflare UI / Git 导入、绑定清单、GitHub Actions、D1 备份 / 恢复 SOP、部署后验收与首轮排障步骤，请看 `docs/部署指南.md`

## 自动化

- 已提供 `GitHub Actions`：`.github/workflows/ci.yml` 会在 `push` / `pull_request` / 手动触发时执行 `npm run ci:verify`，依次覆盖 `test:contract -> smoke -> npm test -> test:unit -> typecheck -> build -> build:worker`
- `.github/workflows/deploy.yml` 现在采用简单分支策略：`release/*` 分支 push 自动走 `staging` 环境，`main` 分支 push 自动走 `production` 环境；手动触发时也可显式选择 `staging` / `production`
- staging 发布会执行 `npm run deploy:staging`，production 发布继续执行 `npm run deploy`；两者都会先复用同一条 `npm run ci:verify`
- CI workflow 会取消同一分支上被后续提交覆盖的旧检查；deploy workflow 会按环境分开串行，避免 staging / production 互相抢占
- 仓库根目录已提交 `.nvmrc` 与 `.node-version` 并固定为 `20`，`package.json` 与 `.npmrc` 也会在安装前拒绝 `Node.js 25+`，避免依赖链在 `sharp` 等原生包上隐晦失败
- 仓库已提交 `package-lock.json`，workflow 当前默认使用 `npm ci`；如需更新依赖版本，再在本地执行 `npm install`
- 新增 `.github/workflows/d1-backup.yml`：每天定时为 production 导出一份 D1 备份，默认保留 `30` 天；如配置 `D1_BACKUP_ARCHIVE_PASSPHRASE`，会自动加密后再上传 artifact
- 如需把备份继续同步到 S3 兼容对象存储，可配置 `D1_BACKUP_ARCHIVE_S3_URI`、`D1_BACKUP_ARCHIVE_ENDPOINT_URL`、`D1_BACKUP_ARCHIVE_SSE`、`D1_BACKUP_ARCHIVE_KMS_KEY_ID` 等变量 / Secret；workflow 会额外执行 `aws s3 cp`，并在 summary 中提示 bucket lifecycle 需在存储侧配置
- 新增 `npm run backup:d1:encrypted`、`npm run backup:d1:decrypt` 与 `npm run d1:restore:drill -- --file <backup.sql|backup.sql.enc>`，方便本地加密归档、解密与恢复演练
- 新增 `.github/workflows/failure-alert.yml`：当 `CI`、`Deploy` 或 `D1 Backup` 失败时会生成 GitHub Actions failure summary；如配置 `FAILURE_WEBHOOK_URL`，还会把通用 JSON payload 推送到外部 webhook

本地安装依赖后，如需镜像 GitHub Actions 的完整校验链路，可执行：

```bash
npm run ci:verify
```

如在受限沙箱或只读 home 目录里执行 `wrangler --dry-run`，可临时把 Wrangler 的配置目录和输出目录改到可写路径：

```bash
XDG_CONFIG_HOME=/tmp WRANGLER_OUTPUT_FILE_DIRECTORY=/tmp npm run ci:verify
```

如果只想做最小检查，也可以按下面顺序逐条执行：

```bash
npm run test:contract
npm run test:smoke
npm test
npm run test:unit
npm run typecheck
npm run build
npm run build:worker
```

## 文档入口

如果你只是自己部署、自己使用，优先只看这 4 篇：

- `README.md`
- `docs/单用户托管模式需求.md`
- `docs/节点管理与订阅使用说明.md`
- `docs/部署指南.md`

这 4 篇已经覆盖单人使用的主线：产品定位、唯一主流程、导入与生成、部署与更新。

其余文档默认都视为仓库内部参考，主要服务于后续开发、接口联调、发布排障和运维，不是单人使用的必读内容。需要时再从 `docs/INDEX.md` 进入即可。
