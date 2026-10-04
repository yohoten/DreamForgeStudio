## ADDED Requirements

### Requirement: 财务汇总 MUST 包含派单失败分布

系统 SHALL 在 `/api/finance/summary` 的响应中提供 `failures`（当日失败任务数）、`failuresByReason`（按 `failureReason` 计数）、`requestsByProvider`（按 `job.started.payload.providerId` 计数）。

#### Scenario: 有失败任务时可聚合

- **WHEN** 当日存在 `job.finished` 且 `payload.ok === false`
- **THEN** `failures` SHALL 大于 0
- **AND THEN** `failuresByReason` SHALL 包含对应 `failureReason` 的计数

### Requirement: job.finished MUST 携带可归因字段

当任务执行失败时，系统 SHALL 在 `job.finished.payload` 中包含：`failureReason`、`durationMs`、`providerId`；若上游返回 HTTP 状态码可用，则 MUST 包含 `upstreamStatus`。

#### Scenario: 上游返回非 2xx

- **WHEN** 上游 `chat/completions` 返回非成功状态
- **THEN** `job.finished` SHALL 使用 `ok:false`
- **AND THEN** `upstreamStatus` SHALL 为上游 HTTP 状态码（若可得）
