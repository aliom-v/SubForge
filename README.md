# SubForge

> 公开仓库可直接使用下面按钮从当前 GitHub 仓库导入到 Cloudflare：
>
> [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Faliom-v%2FSubForge)

SubForge 是一个部署在 Cloudflare 上的单用户托管订阅工具，当前主目标很明确：

- 绑定你自己的域名
- 导入节点文本、上游订阅 URL 或完整配置
- 按当前启用节点统一生成可被 Mihomo / sing-box 客户端拉取的托管 URL
- 不需要传统常驻服务器

当前仓库内部仍保留用户、模板、规则集、缓存这些底层对象来完成订阅编译，但在单用户托管模式下，这些对象默认都由系统自动维护，不要求手动管理。

## 你只需要知道

- 日常基本都在“节点”页完成
- 节点页支持 JSON 批量导入，也支持完整配置导入和订阅 URL 解析
- 节点页支持 `vless` / `trojan` / `vmess` / `ss` / `ssr` / `tuic` / `hysteria2` 分享链接、Base64 订阅文本、JSON 节点清单、完整 Mihomo / Clash YAML、完整 sing-box JSON
- 导入后统一点一次“使用当前启用节点生成托管 URL”，系统会输出 `/s/:token/mihomo` 与 `/s/:token/singbox`
- 自动同步源会保存上游订阅 URL，并由 Worker Cron 按小时自动抓取、解析和回写节点；它不是 Git 仓库同步，只有需要长期跟着上游更新时再启用它
- 当前托管 URL、节点列表、链式代理拓扑都保留在主界面
- Cloudflare Worker + D1 + KV 提供订阅编译、缓存、限流和审计能力

## 当前边界

- 当前公开输出只支持 `mihomo` 与 `singbox`
- 当前不是完整配置编辑器
- 多用户、计费、复杂权限、规则集/模板手工运营都不是当前主路径
- 当前长期同步对象只有“自动同步源”，也就是上游订阅 URL；它会定时把上游订阅解析成节点并回写主链路
- 内部审计与更多后端兼容 helper 仍保留在代码层，但不再作为单用户模式的独立操作面

## 最短本地路径

1. 安装依赖：`npm ci`
2. 一键初始化本地环境：`npm run init:local`
3. 启动 Worker：`npm run dev:worker`
4. 启动 Web：`npm run dev:web`
5. 打开前端主界面，完成首次安装向导
6. 在“节点”页导入节点并执行“使用当前启用节点生成托管 URL”

如果你只想先看最短操作说明，按这个顺序读：

1. [单用户主链路速查](/home/aliom/project/SubForge/docs/单用户主链路速查.md)
2. [节点管理与订阅使用说明](/home/aliom/project/SubForge/docs/节点管理与订阅使用说明.md)
3. [单用户术语速查](/home/aliom/project/SubForge/docs/单用户术语速查.md)
4. [自动同步源状态与错误说明](/home/aliom/project/SubForge/docs/自动同步源状态与错误说明.md)
5. [部署指南](/home/aliom/project/SubForge/docs/部署指南.md)

## 常用命令

- 本地初始化：`npm run init:local`
- 远端初始化：`npm run init:remote`
- 发布：`npm run deploy`
- 轻量纯逻辑回归：`npm run test:unit`
- 完整校验：`npm run ci:verify`

可选：

- 如需在初始化时顺手导入管理员和 demo 数据：`npm run init:local -- --admin-user admin --admin-password your-password --with-demo`
- 如需手动执行本地 migration：`npx wrangler d1 migrations apply DB --local --config ./wrangler.toml`
- 默认本地地址：
  - Worker：`http://127.0.0.1:8787`
  - Web：`http://127.0.0.1:5173`

## 运行环境

- 仓库通过 `.nvmrc` 与 `.node-version` 固定 `Node.js 20`
- 当前支持范围为 `>=20 <25`
- 如本机使用 `Node.js 25+`，安装阶段会直接拒绝不受支持的运行时
- 如本机已安装全局 `libvips >= 8.17.3`，`sharp` 可能切到源码构建路径
- 本地开发时，Vite 会把 `/api`、`/s`、`/health` 自动代理到 Worker
- 如需显式覆盖前端 API 地址，可设置 `VITE_API_BASE_URL=http://127.0.0.1:8787`

## 关键环境变量

- `ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC`
- `ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`
- `SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS`
- `PREVIEW_CACHE_TTL`

完整变量说明和部署绑定方式，统一看 [docs/部署指南.md](/home/aliom/project/SubForge/docs/部署指南.md)。

## 部署与验证入口

- 当前推荐部署形态是 **单 Worker + 静态资源**
- 当前仓库随依赖固定使用 `wrangler@4.77.0`
- 首次远端部署、Cloudflare Dashboard / Git 导入、D1 / KV 绑定、GitHub Actions、备份恢复等完整说明，统一看 [docs/部署指南.md](/home/aliom/project/SubForge/docs/部署指南.md)
- 如在受限沙箱或只读 home 目录里执行 `wrangler --dry-run`，可使用：

```bash
XDG_CONFIG_HOME=/tmp WRANGLER_OUTPUT_FILE_DIRECTORY=/tmp npm run ci:verify
```

当前 GitHub Actions 入口：

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/d1-backup.yml`
- `.github/workflows/failure-alert.yml`
- `release/*` 分支会进入 staging 发布策略
- 失败告警 webhook 入口变量是 `FAILURE_WEBHOOK_URL`

更细的验证边界和 CI 策略，统一看 [docs/自动化验证与CI计划.md](/home/aliom/project/SubForge/docs/自动化验证与CI计划.md)。

## 备份与恢复入口

- 如需查看完整的 `D1 备份 / 恢复 SOP`、对象存储归档与演练路径，统一看 [docs/高级部署与数据维护.md](/home/aliom/project/SubForge/docs/高级部署与数据维护.md)
- 本地恢复演练命令：`npm run d1:restore:drill`
- 本地解密命令：`npm run backup:d1:decrypt`
- 加密归档变量：`D1_BACKUP_ARCHIVE_PASSPHRASE`
- 对象存储归档变量：`D1_BACKUP_ARCHIVE_S3_URI`、`D1_BACKUP_ARCHIVE_ENDPOINT_URL`
- 对象存储上传当前走 `aws s3 cp`
- 生命周期保留策略需要在存储侧配置 `bucket lifecycle`

## 文档与协议补充

- 自动同步源支持常见订阅文本解析与节点回写；默认由 Cron 每小时触发一次
- 页面按钮、状态名和后台概念的统一口径，统一看 [docs/单用户术语速查.md](/home/aliom/project/SubForge/docs/单用户术语速查.md)
- 更细的鉴权、缓存头和 `错误码` 说明，统一看 [docs/API错误码与响应头说明.md](/home/aliom/project/SubForge/docs/API错误码与响应头说明.md)

## 文档入口

如果你只是自己部署、自己使用，优先只看这几篇：

- [单用户主链路速查](/home/aliom/project/SubForge/docs/单用户主链路速查.md)
- [单用户托管模式需求](/home/aliom/project/SubForge/docs/单用户托管模式需求.md)
- [节点管理与订阅使用说明](/home/aliom/project/SubForge/docs/节点管理与订阅使用说明.md)
- [单用户术语速查](/home/aliom/project/SubForge/docs/单用户术语速查.md)
- [自动同步源状态与错误说明](/home/aliom/project/SubForge/docs/自动同步源状态与错误说明.md)
- [部署指南](/home/aliom/project/SubForge/docs/部署指南.md)

其余文档默认都属于仓库内部参考。完整导航看 [docs/INDEX.md](/home/aliom/project/SubForge/docs/INDEX.md)。
