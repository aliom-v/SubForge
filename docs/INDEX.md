# SubForge 文档导航

## 1. 快速入口

如果你只想快速开始，建议按下面顺序阅读：

1. `README.md`
2. `docs/部署指南.md`
3. `docs/API错误码与响应头说明.md`
4. `docs/排障与常见问题.md`

## 2. 按主题找文档

### 2.1 总览与规划

- `README.md`
  - 项目总览、环境变量、部署入口、文档入口
- `docs/实施方案.md`
  - 长期设计基线、模块边界、架构原则与阶段划分
- `.omx/plans/2026-03-07-subforge-roadmap.md`
  - 当前实现进度与下一步推荐执行项
- `CHANGELOG.md`
  - 版本变更、已完成能力与文档演进记录

### 2.2 部署与运行

- `docs/部署指南.md`
  - 本地运行、Cloudflare Dashboard / Git 导入、GitHub Actions、staging / production 分支策略、绑定清单、D1 备份 / 恢复 SOP、部署后验收与首轮排障
- `docs/运维Runbook与告警处理.md`
  - `npm run ci:verify`、failure summary / webhook、发布 / 回滚 checklist、值班响应、恢复演练与告警优先级

### 2.3 API 与协议

- `docs/API错误码与响应头说明.md`
  - 公共协议约定、Bearer 鉴权、错误码、缓存头、限流头速查
- `docs/API错误响应示例库.md`
  - 常见 4xx / 5xx 场景的可复制响应示例与 5xx 现状说明
- `docs/API接口矩阵与OpenAPI草案.md`
  - 当前路由矩阵、鉴权范围与接口阅读说明
- `openapi.yaml`
  - 机器可读的正式 OpenAPI 规范，可用于 Swagger / Redoc / 代码生成，并已补关键 request / response examples
- `npm run test:contract`
  - 纯 Node.js 的契约检查，校验公开鉴权边界与前端路由清单是否仍与规范一致

### 2.4 安全、排障与数据

- `docs/限流与安全策略.md`
  - 管理员登录失败限流、公开订阅频控、调参建议与安全边界
- `docs/排障与常见问题.md`
  - 症状驱动 FAQ：本地开发、部署异常、缓存、鉴权、`429`、HTML 回退
- `docs/数据模型与表结构说明.md`
  - 当前 D1 表结构、索引、关系、共享类型映射
- `docs/架构图与ER图.md`
  - 系统分层、关键数据流、Mermaid 架构图与实体关系图

### 2.5 使用与专题补充

- `docs/节点管理与订阅使用说明.md`
  - 后台操作路径、节点导入、绑定、预览与日常使用说明
- `docs/协议支持矩阵与落地计划.md`
  - 当前协议支持层级、未覆盖边界与后续落地顺序
- `docs/API参考与接口约定.md`
  - 面向开发联调的路由、成功/失败包络与请求示例
- `docs/常见错误与返回语义.md`
  - 高频状态码、错误码和容易误解的成功语义
- `docs/发布前检查清单.md`
  - 部署完成后的最小验收、缓存检查与回归顺序

### 2.6 状态与执行记录

- `docs/已知问题与修复计划.md`
  - 当前限制、风险点与建议修复优先级
- `docs/自动化验证与CI计划.md`
  - 测试覆盖范围、CI 策略与验证边界
- `docs/archive/README.md`
  - 历史文档归档入口；批次执行记录已统一收进归档目录，适合追溯，不作为首次接手必读入口

## 3. 按任务找文档

- 第一次接手项目：`README.md`、`docs/实施方案.md`、`docs/架构图与ER图.md`
- 我要把项目部署起来：`docs/部署指南.md`、`docs/运维Runbook与告警处理.md`、`docs/排障与常见问题.md`
- 我要调后台 API 或写客户端：`docs/API参考与接口约定.md`、`docs/常见错误与返回语义.md`、`docs/API错误码与响应头说明.md`、`docs/API错误响应示例库.md`、`docs/API接口矩阵与OpenAPI草案.md`、`openapi.yaml`
- 我要理解数据库和缓存：`docs/数据模型与表结构说明.md`、`docs/架构图与ER图.md`、`docs/实施方案.md`
- 我在排查线上问题：`docs/排障与常见问题.md`、`docs/运维Runbook与告警处理.md`、`docs/限流与安全策略.md`

## 4. 维护约定

- `README.md` 只保留项目总览、快速开始和文档入口，不重复展开长篇 SOP
- `docs/部署指南.md` 只保留部署、绑定、恢复与 GitHub Actions 的操作步骤
- `docs/运维Runbook与告警处理.md` 只保留巡检、告警、发布 / 回滚策略和恢复演练检查表
- API 文档按“协议语义 / 错误示例 / 路由矩阵 / 正式 OpenAPI”四份拆开维护，避免同一信息四处复制

## 5. 当前覆盖与后续增强

当前文档已经覆盖：

- 部署
- API 协议
- FAQ / 排障
- 正式 OpenAPI
- 数据模型
- 架构图 / ER 图
- 发布 / 回滚 checklist
- D1 备份 / 恢复 SOP
- 自动化 D1 定期备份脚本 / 恢复演练
- 备份产物异地加密归档 / 对象存储同步 / 生命周期管理

后续如果继续增强，建议优先补：

- 更完整的 4xx / 5xx 响应示例库
- 备份归档完整性巡检 / 生命周期告警
- OpenAPI example / schema 细化
