# Node 24 与单用户主链路优化计划

## 1. 目标

本轮优化只处理低风险、可验证的收敛项：

1. 把仓库推荐运行时统一到 `Node.js 24 LTS`。
2. 删除已经脱离当前主链路的旧规则源接口痕迹。
3. 统一文档中 Node 版本、部署路径和单用户托管模式表述。
4. 优化主界面顺序，让用户按“导入节点 -> 调整节点 -> 生成托管 URL -> 复制订阅地址”完成操作。

## 2. 非目标

- 不支持 `Node.js 25+`。当前依赖链仍以 LTS 版本为安全边界。
- 不新增依赖。
- 不改 D1 schema、KV key 结构或公开订阅 URL 格式。
- 不把 SubForge 扩展成多用户管理平台或完整配置编辑器。

## 3. 行为保护

动代码前先锁定现有行为：

- `npm run doctor:runtime`
- `npm run test:smoke`
- `npm run test:unit`
- `node --test tests/compile-subscription.test.mjs`

最终验证使用 `Node.js 24` 执行：

- `npm run ci:verify`
- `npm audit --json`
- `git diff --check`

## 4. 执行顺序

### 阶段一：运行时统一

范围：

- `.nvmrc`
- `.node-version`
- `scripts/check-runtime.mjs`
- `.github/workflows/*.yml`
- `README.md`
- `docs/部署指南.md`

原则：

- 推荐版本改为 `Node.js 24 LTS`。
- 支持范围继续保持 `>=20 <25`，避免一次性抬高最低版本造成不必要兼容风险。

### 阶段二：旧规则源残留清理

范围：

- `packages/shared/src/constants.ts`
- `packages/shared/src/domain.ts`
- `packages/shared/src/cache.ts`
- `packages/core/src/models.ts`
- `packages/core/src/compile.ts`
- `packages/core/src/renderers.ts`
- `packages/core/src/bootstrap.ts`
- 相关测试与 smoke 断言

清理项：

- 删除 `RULE_SOURCE_FORMATS`、`RuleSourceFormat`。
- 将远程同步状态改成独立联合类型，不再依赖 `SYNC_LOG_STATUSES`。
- 删除 `ruleSnapshot`、`ruleActive` cache key 与 builder。
- 删除 `SubscriptionRuleSet` 与 `SubscriptionCompileInput.ruleSets`。
- Renderer 默认继续输出最小安全规则：
  - Mihomo：`MATCH,DIRECT`
  - sing-box：空 `rules` 数组，静态模板已有规则不被额外注入。

### 阶段三：文档口径统一

范围：

- `README.md`
- `docs/部署指南.md`
- `docs/自动化验证与CI计划.md`
- `docs/单用户主链路速查.md`
- `docs/节点管理与订阅使用说明.md`
- `docs/INDEX.md`

原则：

- 把“Node 20 推荐”统一成“Node 24 LTS 推荐”。
- 保持当前主路径：单 Worker + 静态资源，单用户托管订阅。
- 明确导入不会自动刷新托管订阅，必须执行生成动作。

### 阶段四：前端主流程优化

范围：

- `apps/web/src/App.tsx`
- `apps/web/src/components/HostedSubscriptionSection.tsx`
- 相关 smoke 断言

优化项：

- 主界面顺序改成：导入节点、管理节点、生成并复制托管 URL。
- 生成成功后直接展示 Mihomo / sing-box URL 卡片，不再把复制入口藏在折叠诊断里。
- 诊断信息保留在折叠区，避免主路径被排障信息压住。

## 5. 风险与回退

- 删除 `ruleSets` 是内部 API 收敛；旧 Worker 主链路此前只传空规则集，公开功能不受影响。
- 如果 CI 暴露模板兼容问题，优先恢复 renderer 默认规则输出，不恢复旧规则源对象。
- 如 Node 24 下 `npm ci` 产生 lockfile 差异，只接受安全补丁或 npm 布局必要变化，不做无关依赖升级。

## 6. 执行记录

本轮已完成：

- `.nvmrc`、`.node-version`、GitHub Actions 与 runtime doctor 统一到推荐 `Node.js 24`。
- 删除旧规则源相关共享常量、cache key builder、`SubscriptionRuleSet` 与编译输入中的 `ruleSets`。
- 公开 preview metadata 不再暴露 `ruleSetCount`。
- 文档统一为单用户托管主路径与 Node 24 LTS 推荐口径。
- 主界面顺序调整为导入节点、管理节点、生成并复制托管 URL。
- 生成后的 Mihomo / sing-box URL 直接展示，诊断信息保留在折叠区。

已验证：

- `npm ci` on `Node.js 24.15.0`
- `npm run ci:verify` on `Node.js 24.15.0`
- `npm audit --json` returned `total: 0`
- `git diff --check`
