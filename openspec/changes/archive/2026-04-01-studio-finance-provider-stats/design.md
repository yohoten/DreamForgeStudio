# 设计：财务派单统计

## 数据流

1. `runJob` 执行上游 `chat/completions`（流式）。
2. 失败时在 `job.finished.payload` 写入：`ok:false`、`failureReason`、`upstreamStatus?`、`durationMs`、`providerId`。
3. `/api/finance/summary` 扫描当日 JSONL 事件：`job.started` 计请求与 provider；`job.finished` 且 `ok:false` 计失败并按 `failureReason` 聚合。

## 失败归因

- HTTP 429 → `rate_limited`
- `AbortController` 在接近超时窗口触发 → `timeout`，否则 → `aborted`
- 其它 HTTP 4xx/5xx → `upstream_http_error`

## UI

- `apps/studio-web/index.html` 财务区增加三行展示。
- `refreshFinance` 填充新字段。
