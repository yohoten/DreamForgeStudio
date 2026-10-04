# studio-events-bus（变更增量）

## ADDED Requirements

### Requirement: 任务失败事件形状
当队列任务或代理阶段失败时，系统 SHALL 发出 `job.failed` 事件（若与既有事件类型统一则沿用唯一类型名，但 SHALL 在文档中固定该名称），且 payload SHALL 包含 `message: string` 与 `correlationId: string`，SHOULD 包含 `jobId?: string` 与 `stage?: string`。

#### Scenario: envelope 仍满足最小字段
- **WHEN** `job.failed` 进入总线
- **THEN** 事件 SHALL 仍满足既有「事件字段最小集合」要求（`ts`、`type`、`sessionId`、`correlationId`、`payload`）

#### Scenario: 与 UI 推导兼容
- **WHEN** UI 收到 `job.failed`
- **THEN** UI MAY 将该条计入「最近失败」列表而不破坏既有 Agent 状态推导逻辑
