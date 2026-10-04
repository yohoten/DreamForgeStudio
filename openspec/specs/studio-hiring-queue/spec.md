# studio-hiring-queue Specification

## Purpose
TBD - created by archiving change kairo-studio-web-ui-telemetry. Update Purpose after archive.
## Requirements
### Requirement: ComputeSlots 限制并发
系统 SHALL 以 ComputeSlots 作为并发槽位上限：默认值为 1（串行），允许用户调整到小并行（例如 2–8）。

#### Scenario: 串行默认
- **WHEN** 系统首次启动且无用户配置
- **THEN** ComputeSlots SHALL 为 1

### Requirement: 任务队列与优先级
系统 SHALL 提供任务队列，任务包含：agentId、task 文本、priority、创建时间与状态；调度规则 SHALL 为 priority 降序，同优先级 FIFO。

#### Scenario: 高优先级先执行
- **WHEN** 队列中存在优先级更高的待执行任务
- **THEN** 调度器 SHALL 先启动高优先级任务

### Requirement: 雇佣名单（可选门禁）
系统 SHALL 支持“雇佣名单”作为派单门禁：当雇佣名单非空时，只允许对已雇佣的 agentId 派单；当雇佣名单为空时，系统 MUST 不限制派单。

#### Scenario: 未雇佣不可派单
- **WHEN** 雇佣名单非空且用户尝试对未雇佣 agent 派单
- **THEN** 系统 SHALL 拒绝该入队请求并返回错误

### Requirement: 任务生命周期事件
系统 SHALL 为任务生命周期产出事件：`job.enqueued`、`job.started`、`job.finished`，并尽力将执行过程的 LLM 流式输出记录为 `llm.chunk`。

#### Scenario: 入队到完成
- **WHEN** 一条任务成功入队并被执行
- **THEN** 系统 SHALL 依次产出 `job.enqueued`、`job.started`、`job.finished`（允许中间有 `llm.chunk` 多次出现）

### Requirement: Provider 选择与归因
系统 SHALL 支持为每个任务选择 provider（本地/局域网/外部 API），并在任务事件中可被 UI 识别，用于成本可视化与建议解释。

#### Scenario: 入队指定 provider
- **WHEN** 用户入队任务时指定 `providerId`
- **THEN** 系统 SHALL 将该 `providerId` 绑定到该任务
- **AND THEN** 在 `job.started` 的 payload 中 SHOULD 包含该 `providerId`

### Requirement: 自动外包（可选策略）
系统 SHALL 提供“自动外包/自动切换 provider”的策略开关：当本地端点不可用、延迟过高或队列积压明显时，将新任务自动切换到外部 API provider；该策略 MUST 可被用户关闭。

#### Scenario: 本地不可用则自动外包
- **GIVEN** 自动外包已开启
- **WHEN** 本地 provider 不可用（例如 `/v1/models` 不可达）或 bench 首包延迟超过阈值
- **THEN** 系统 SHOULD 将新入队任务的 provider 选择为外部 API（例如 `cloud`）
- **AND THEN** UI SHOULD 能看到“切换原因”的中文提示（可来自 advice API 或事件摘要）

### Requirement: 上游不可用的降级
当上游模型端点不可用或不支持流式时，系统 MUST 降级为可玩的模拟输出，保证队列可推进且 UI 不被阻塞。

#### Scenario: 上游不可用仍可完成任务
- **WHEN** 调度器启动任务但上游请求失败
- **THEN** 系统 SHALL 产出一段模拟 `llm.chunk` 并结束该任务（`job.finished`）

