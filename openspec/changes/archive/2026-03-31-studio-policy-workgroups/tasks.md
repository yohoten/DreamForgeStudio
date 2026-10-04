## 1. Policy（管理策略系统）

- [x] 1.1 服务端：新增 `GET/POST /api/policy`（策略配置持久化，含默认值）
- [x] 1.2 服务端：实现“规则模式”策略执行（制作人拆单/派单、技术总监降级/外包、创意总监验收门禁）
- [x] 1.3 事件：新增/补齐 `policy.decision` 事件（记录策略决策原因，便于回放与调参）
- [x] 1.4 Web：新增“策略面板”（三总监：规则/模型增强开关 + 阈值配置 + 说明）

## 2. 部门显示器 → 验收工单

- [x] 2.1 Web：每个部门显示器打开“部门工单”弹窗（已在场景内放置显示器的基础上完善）
- [x] 2.2 Web：部门工单展示指标（产出/问题/卡点/老板介入提示）并从事件流实时聚合
- [x] 2.3 Web：部门工单动作“通过/驳回/重做”入队时携带部门与项目归因
- [x] 2.4 服务端：工单动作按 policy 生成更精确的派单文本（不同部门不同模板）

## 3. Workgroups / Projects（多项目并行）

- [x] 3.1 服务端：新增 project/workgroup 内存模型与 API（列表/创建/切换当前项目）
- [x] 3.2 服务端：并行项目上限（由 advice/policy 决定）与阻止规则（提示升级算力/调整策略）
- [x] 3.3 服务端：`/api/queue/enqueue` 支持 `projectId/workgroupId` 并落盘到 job
- [x] 3.4 事件：`job.*` payload 增加 `projectId/workgroupId`（最小字段）

## 4. Preview Sandbox（按项目预览）

- [x] 4.1 服务端：`GET /preview?projectId=` 与 `POST /api/preview/save` 支持按 projectId 存储隔离（`production/preview/<projectId>/index.html`）
- [x] 4.2 Web：显示器弹窗支持选择 projectId（下拉切换）并刷新 iframe
- [x] 4.3 Web：保存预览时携带 projectId，并在保存后自动刷新对应预览
- [x] 4.4 安全增强（可选）：为预览 iframe 增加 `sandbox` 属性与最小 CSP（后续迭代）

