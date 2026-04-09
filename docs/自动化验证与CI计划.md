# SubForge 自动化验证与 CI 计划

## 1. 文档目的

本文档用于把“补测试 / 补 CI”这件事收敛成一份可执行清单，避免只停留在口头计划。

当前原则：

- 先补最小回归保护，再考虑完整测试矩阵
- 先覆盖最近修过、最容易回归的路径
- 优先使用仓库现有能力，避免为测试体系一次性引入过多复杂度

---

## 2. 当前基线

当前最小自动化验证已经固定为三层：

1. 契约与文档结构检查：`npm run test:contract` + `npm run test:smoke`
2. 根级请求级 / 集成测试：`npm test`
3. 纯逻辑单测、类型检查与构建：`npm run test:unit` + `npm run typecheck` + `npm run build` + `npm run build:worker`

当前进展：`done`

- 已把上述链路收敛到 `npm run ci:verify`
- 已接入 GitHub Actions `CI` / `Deploy` 复用同一条校验命令
- 已覆盖单用户主路径、缓存正确性、自动同步源、协议矩阵和发布前关键回归

当前仍不追求：

- Web 组件级测试
- 真实 D1 / KV / Cron 集成测试
- 真实外部自动同步源的端到端网络测试
- 覆盖率门槛与测试报告平台接入

---

## 3. 当前约束

落地前仓库现状：

- 已有 `npm run typecheck`
- 已有 `npm run build`
- 已有 `npm run test:smoke`
- 仓库内已存在基于 `node:test` 的单元测试与请求级集成测试文件
- 当前运行环境 Node 版本支持 `node --test` 和 `--experimental-strip-types`

基于上述约束，第一版测试优先采用：

- Node 内置 `node:test`
- 直接测试 TypeScript 源文件
- 少量手写 mock，先覆盖纯逻辑与 Worker handler 关键分支

---

## 4. 当前核心验证面

### 4.1 订阅编译核心

目标文件：

- `packages/core/src/compile.ts`
- `packages/core/src/renderers.ts`

当前至少覆盖：

- `compileSubscription` 成功生成 Mihomo / sing-box 订阅
- 禁用用户返回 `USER_DISABLED`
- 过期用户返回 `USER_EXPIRED`
- 无可用节点返回 `NO_NODES_AVAILABLE`
- 空规则集时的默认规则兜底
- `ssr` / `tuic` / `hysteria2` 的 metadata 映射与模板输出矩阵

### 4.2 Worker 公开订阅关键路径

目标文件：

- `apps/worker/src/index.ts`

当前至少覆盖：

- `mihomo` / `singbox` 的公开订阅在缓存命中但用户不存在时返回 `404`，并清理旧缓存
- `mihomo` / `singbox` 的公开订阅在缓存命中但用户已禁用时返回 `400`，并清理旧缓存
- `mihomo` / `singbox` 的公开订阅在缓存命中但用户已过期时返回 `400`，并清理旧缓存
- `mihomo` / `singbox` 的公开订阅在缓存命中且用户有效时直接返回缓存内容，并保持 target 对应的 `content-type`
- `mihomo` / `singbox` 的 preview/public `miss -> hit` 请求级链路
- 节点 / 绑定 / 模板 / 自动同步源变化后的 preview/public 一致性与缓存失效
- 登录 / 登出 / 会话撤销 / 写接口边界拒绝等关键请求语义

说明：

- 第一版只 mock `env.DB` 与 `env.SUB_CACHE` 的最小接口
- 不在本轮引入真实 D1 / KV 依赖

### 4.3 CI

当前固定执行：

- `npm ci`
- `npm run test:contract`
- `npm run test:smoke`
- `npm test`
- `npm run test:unit`
- `npm run typecheck`
- `npm run build`
- `npm run build:worker`

当前已落 GitHub Actions `CI` 与 `Deploy`，后续如需继续扩展，优先考虑：

- 覆盖率上传
- 更真实的远程依赖集成校验

---

## 5. 批次记录与当前状态

仓库历史上曾按批次保留测试补齐与文档收敛执行稿，但这些内容大多已经被第 2 节、第 4 节和当前主文档吸收。

为避免 `docs/` 继续堆积大量“只剩追溯价值”的旧执行稿，本轮已清理逐批归档文件；当前只保留仍然对现在决策有价值的汇总结论。

如需追溯更细的演进过程，统一看：

- `docs/archive/README.md`
- Git 历史

当前已经稳定收敛出的结果可以概括为：

- 缓存失效 helper、公开订阅关键路径、管理员鉴权、登出服务端撤销、审计脱敏与 setup/bootstrap 边界都已落到请求级回归
- `mihomo` / `singbox` 的 preview/public `miss -> hit`、token 重置、节点 / 绑定 / 模板 / 自动同步源变化后的结果一致性已经纳入当前验证基线
- create/update/delete/bind 四类现有写接口、模板默认语义、节点 metadata 收紧语义与本地部署前 smoke 配置断言已经收敛
- Web 侧协议向导、分享链接导入、远程预览导入、Base64 解包与单用户主流程编排 helper 测试已经落地
- `ss` / `ssr` / `tuic` / `hysteria2` 的导入、完整配置矩阵与 preview/public 长链路回归已经进入当前默认验证面
- 文档导航、API 专题、发布前检查清单与 `npm run ci:verify` 已成为当前唯一维护基线；后续不再继续新增逐批执行稿

补充进展：

- 管理员登出已升级为服务端会话撤销，`/api/admin/logout` 会写入 `session_not_before`
- 已补 logout -> `/api/admin/me` 的请求级回归，验证旧 token 在撤销后返回 `401`
- smoke 文档与断言已同步到 `npm run db:migrations:apply:local`
- 已新增单用户托管主路径前端编排 helper 测试，覆盖节点导入、完整配置导入、自动同步源保存与统一生成托管 URL 的顺序语义
- 已新增用户节点绑定变更后的 preview/public 一致性请求级回归，覆盖发布前检查清单中的同对象一致性与公开订阅变化
- 已新增默认模板切换后的 preview/public 请求级回归，覆盖发布前检查清单中的“切换默认模板后结果反映新模板”
- 已把 `node.update` 长链路回归扩到 preview 侧，覆盖发布前检查清单中的“修改节点后再次请求预览”
- 已新增自动同步源导入 / 删除 / 手动同步后的请求级长链路回归，覆盖发布前检查清单中的“同步源变化后再次请求订阅”
- 已新增 `singbox` target 的 preview/public `miss -> hit` 请求级回归，并把 `ssr` / `tuic` 的 share-link import -> create -> bind -> preview/public 长链路扩到 `singbox`
- 已新增 `hysteria2` 复杂 share-link 回归，覆盖 `userinfo user:pass` 与 `hop-interval/up/down/upmbps/downmbps` 参数保留语义

---

## 6. 完成标准

满足以下条件，可认为第一阶段“自动化验证”落地：

- 仓库内存在可执行的单元测试文件
- `npm test` 可在本地直接运行
- CI 会自动执行安装、契约检查、smoke、根级请求级测试、单元测试、类型检查与构建
- 最近修复的关键路径至少具备最小回归保护
