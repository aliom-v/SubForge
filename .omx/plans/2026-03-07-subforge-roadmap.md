# SubForge 执行计划

## 目标

基于 `项目介绍.md` 与 `docs/实施方案.md`，按阶段把 SubForge 从空仓库逐步实现为可部署的 Cloudflare 订阅管理平台。

## 决策

- 使用 Monorepo
- 使用 `npm workspaces`
- 使用 React + Vite 构建后台
- 使用 Cloudflare Workers + D1 + KV + Cron 构建服务端
- 先做 MVP，再做增强功能

## 阶段拆分

### P0：工程初始化
- 建立根 `package.json`
- 初始化 `apps/web`
- 初始化 `apps/worker`
- 建立根 tsconfig、基础脚本
- 增加 `wrangler.toml`
- 编写首版 migration

状态：已完成

### P1：核心领域模型
- 建立 `packages/shared` 领域类型
- 建立 `packages/core` 订阅中间模型
- 定义 renderer 接口
- 定义错误码和 cache key
- 定义订阅编译入口

状态：已完成

### P2：数据层与 API
- 实现数据库访问层
- 实现管理员登录
- 实现用户 / 节点 / 模板 / 规则源基础管理接口
- 实现公开订阅接口
- 实现后台预览接口

状态：已完成（已补用户 / 节点 / 模板 / 规则源删除，节点源同步仍未实现）

### P3：后台界面
- 登录页
- 用户管理页
- 节点管理页
- 模板管理页
- 规则源管理页
- 同步日志 / 审计日志页
- 订阅预览页

状态：已完成

### P4：同步与缓存
- 手动同步
- Cron 同步
- KV 缓存
- 预览缓存
- 按用户 / 节点 / 模板粒度失效
- 用户节点绑定
- 同步日志
- 审计日志

状态：已完成（持续增强中）

### P5：上线前完善
- 审计字段增强
- 更强的规则同步错误展示
- 部署文档补完
- CI / CD 脚本
- 一键初始化流程

状态：进行中

## 本轮已完成

- 前端补齐资源创建 + 编辑表单，并增加基础表单校验
- 增加用户节点绑定面板
- 增加同步结果、同步日志、审计日志展示
- 后端补齐资源更新接口、输入校验与审计记录
- 审计日志联表管理员名称，并附带请求上下文
- 规则源同步支持 `text/yaml/json` 轻量解析、去重、哈希比较与结构化 details
- 缓存策略细化到预览缓存、节点影响用户、模板影响目标类型
- 公开订阅缓存命中前增加用户存在 / 状态 / 到期最小校验
- README / 实施方案 / 路线图已收敛到当前真实能力描述
- 登出接口已升级为服务端会话撤销，前端提示与返回值已同步
- 增加 `npm test` 与第一批 Node 内置测试，覆盖订阅编译核心和公开订阅关键路径
- 增加 GitHub Actions `CI`，执行安装、typecheck、build、smoke、test
- 第二批测试已覆盖缓存失效 helper、管理员登录 / 鉴权关键路径、审计脱敏
- 非法 Bearer token 现在会稳定返回 401，不再因解码异常导致请求失败
- 第三批测试已覆盖模板默认切换 / 当前生效模板更新失效、规则源启停失效、规则源同步成功 / 跳过语义
- 第四批测试已覆盖同步失败详情与 `/api/rule-sources/:id/sync` 请求级成功 / 失败 / 404 语义
- 第五批测试已覆盖 setup/bootstrap 登录闭环、preview/public miss -> hit 链路、health/assets/scheduled 基础回归
- 第六批测试已覆盖 user/node/template 写后再读长链路，并补审计脱敏对 token 布尔标记的回归保护
- 第七批测试已覆盖 setup/bootstrap 校验边界、logout/preflight/非 GET 静态回退边界，以及 wrangler/本地初始化 smoke 断言
- 第八批测试已覆盖 user/node/template/rule-source 剩余 update/bind 边界，并修复 `POST /api/users/:id/nodes` 对缺失用户 / 未知节点不显式拒绝的问题
- 第九批测试已覆盖 user/node/template/rule-source create 请求边界
- 第十批测试已覆盖 user/template/rule-source 删除链路与请求级回归
- 已补管理员服务端会话撤销与 logout -> me 回归，本地 migration 文档统一为 `npm run db:migrations:apply:local`
- 已补节点写接口对 `remote/sourceId` 与 metadata 类型的语义收紧，请求级回归覆盖 `POST/PATCH /api/nodes`
- 已补节点使用说明文档与 Web 节点 metadata 手动录入，并把节点能力边界收敛到真实实现
- 已补 Web 节点协议向导，`vless` / `trojan` / `vmess` / `ss` 可通过结构化字段回填 metadata JSON
- 已补 Web 节点分享链接导入，支持 `vless://` / `trojan://` / `vmess://` 解析、预览和批量创建
- 已补订阅 URL 远程抓取预览导入，Worker 与 Web 复用共享解析器，支持预览后批量创建成功节点
- 已补 Base64 包装订阅文本自动解包，远程预览与本地粘贴导入都能识别常见订阅返回格式
- 已补 `ss://` 分享链接导入，常见可导入协议扩到 `vless` / `trojan` / `vmess` / `ss`
- 已补 `ss` 结构化协议向导，以及 `hysteria2://` / `hy2://` 导入与远程预览回归
- 已补协议支持矩阵与落地路线文档，当前实现、文档与后续顺序已有统一基线
- 已补 `ss` / `hysteria2` 的文档细粒度说明，字段映射、已知限制与排障口径已写实化
- 已补协议示例库中的 `ss` / `hysteria2` 常见报错对照，以及“预览有变化但公开订阅没变化”的独立排障分支
- 已补统一文档导航页，README、部署指南与节点使用说明现在都有统一入口
- 已补 API 参考、节点字段字典、常见错误与返回语义三份专题文档，并为文档导航补开发 / 运维 / 运营阅读路径
- 已补 API 参考中的状态码速查与完整请求 / 响应示例、字段字典中的 `ss` / `hysteria2` 导入映射表、错误跳转索引与发布前检查清单
- 已补默认模板启用态语义收紧，请求级回归覆盖 template.create / template.update / template.set-default
- 已补默认模板在禁用时自动清除默认标记的持久化语义与请求级回归，避免 disabled 模板残留 `is_default=1`
- 增加零依赖 `test:smoke` 检查脚本
- 增加首次安装向导与初始管理员创建 API
- 调整 `wrangler.toml` 为更友好的 Dashboard / Git 导入默认配置
- 增加 Deploy to Cloudflare 按钮模板与部署脚本
- 把 `apps/web` 作为 Worker 静态资源一起部署，减少 Pages 依赖

## 当前推荐执行项

当前已知问题与修复顺序详见 `docs/已知问题与修复计划.md`。

1. 在 `docs/第二十二批自动化验证执行清单.md`、`docs/第二十三批自动化验证执行清单.md`、`docs/第二十四批自动化验证执行清单.md`、`docs/第二十五批自动化验证执行清单.md` 与 `docs/第二十六批自动化验证执行清单.md` 已落地的结构化向导、协议级校验、独立排障文档、统一文档入口、接口 / 字段 / 错误文档基线和发布前检查清单之上，继续补 `hysteria2` 多端口与更多复杂分享链接变体
2. 在上述协议产品化基线稳定后，再决定是否继续补下一批主流协议、远程节点源同步与持久化建模，或保持“手动录入 + 导入预览”的写实路线
3. 继续把测试从当前 create/update/delete/bind/logout 基线扩展到更多错误矩阵与发布前回归
4. 在上述问题稳定后，再继续增强规则源解析与一键初始化流程
5. 继续完善审计与部署闭环
