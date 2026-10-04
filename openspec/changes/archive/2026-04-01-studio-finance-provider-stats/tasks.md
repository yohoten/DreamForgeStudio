## 1. 服务端

- [x] `runJob`：`job.finished` 写入 `failureReason`、`upstreamStatus`、`durationMs`、`providerId`
- [x] `/api/finance/summary`：聚合 `failures`、`failuresByReason`、`requestsByProvider`

## 2. Web

- [x] 财务面板增加「今日失败 / 失败原因 / 提供方分布」
- [x] `refreshFinance` 展示新字段
