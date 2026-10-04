# studio-events-bus Specification

## Purpose
TBD - created by archiving change kairo-studio-web-ui-telemetry. Update Purpose after archive.
## Requirements
### Requirement: 统一事件 envelope
系统 SHALL 使用统一的事件 envelope 表达所有 Studio 事件（LLM/工具/文件变更/房间/队列/招聘等），并保证该 envelope 可被追加写入日志与实时分发。

#### Scenario: 事件被记录并可分发
- **WHEN** 系统产生任意一条 Studio 事件
- **THEN** 事件 SHALL 以单行 JSON 追加写入事件日志（JSONL）
- **AND THEN** 事件 SHALL 被实时分发给所有 WebSocket 订阅者

### Requirement: 事件字段最小集合
每条事件 SHALL 至少包含：时间戳、类型、会话 ID、关联 ID、可选 agentId、以及 payload。

#### Scenario: 校验最小字段
- **WHEN** 任意事件进入事件总线
- **THEN** 事件 SHALL 包含 `ts`、`type`、`sessionId`、`correlationId`、`payload`

### Requirement: UI 可由事件推导 Agent 状态
UI 侧 SHALL 仅依赖事件流推导 Agent 状态（busy/idle/tool/error 等），避免将模型输出作为唯一真理源。

#### Scenario: LLM chunk 驱动忙碌状态
- **WHEN** UI 收到 `llm.chunk` 事件且带 `agentId`
- **THEN** UI SHALL 将该 agent 状态推导为“streaming”

### Requirement: 事件回放（tail）
服务端 SHALL 提供事件 tail 能力，用于 UI 迟到连接时的状态恢复。

#### Scenario: 新打开 UI 仍可看到已有状态
- **WHEN** UI 在事件已产生后才连接
- **THEN** UI SHALL 能通过 tail API 拉取最近 N 行事件并恢复状态

### Requirement: Provider/成本归因字段（可选但推荐）
为支持“金币扣费/电费提示/财务解释”等科普可视化，事件 payload MUST 提供最小归因字段，使 UI 能将输出与 provider 关联起来。

#### Scenario: job.started 携带 providerId
- **WHEN** 服务端产出 `job.started`
- **THEN** 该事件的 `payload` SHOULD 包含 `providerId`（例如 `local`/`lan`/`cloud`）

#### Scenario: UI 可结合 API 汇总展示成本
- **WHEN** UI 需要展示 tokens/费用等统计
- **THEN** UI MAY 通过单独的汇总 API（例如 finance summary/advice）获取估算值
- **AND THEN** UI SHOULD 将其与事件流的 agent/job/provider 归因结合，用于“金币扣费/秘书播报”等反馈

