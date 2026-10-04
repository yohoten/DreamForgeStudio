# studio-finance-provider-stats

## 背景

Studio 派单执行依赖上游大模型，用户需要直观看到：**每次任务对应的请求、失败原因（429/timeout/aborted 等）**，以便决定是否升级云端套餐或调超时。

## 目标

- 财务面板展示：**今日失败次数、失败原因分布、按 provider 的请求分布**。
- `job.finished` 事件 MUST 携带可聚合的 `failureReason`、`upstreamStatus`（如有）、`durationMs`。

## 非目标

- 不替代上游官方 billing；tokens/成本仍为估算。

## 验收

- `/api/finance/summary` MUST 返回 `failures`、`failuresByReason`、`requestsByProvider`。
- Web UI「财务」MUST 展示上述字段。
