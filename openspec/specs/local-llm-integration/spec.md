# local-llm-integration Specification

## Purpose
TBD - created by archiving change kairo-studio-web-ui-telemetry. Update Purpose after archive.
## Requirements
### Requirement: 可观测边界（代理接入）
本项目在本地模型工作流中 SHALL 提供“可观测边界”，以便将 LLM 流式输出与相关事件输入到 Studio UI 的事件总线中。

#### Scenario: Cursor 通过代理可见流事件
- **WHEN** 用户将 OpenAI-compatible 客户端（如 Cursor）`baseURL` 指向 `http://127.0.0.1:<studio-port>/v1`
- **THEN** 系统 SHALL 记录并分发 `llm.chunk` 与 `llm.message_done` 事件，供 Studio Web UI 实时显示

### Requirement: 任务拆分与并发纪律
在本地算力有限场景下，系统文档/工作流 SHALL 明确推荐“默认串行 + 可选小并行”的纪律，并提供 ComputeSlots 的解释与调度入口。

#### Scenario: 用户知道如何调整并发
- **WHEN** 用户查看本地模型工作流说明
- **THEN** 用户 SHALL 能找到 ComputeSlots 的含义、默认值、以及如何通过 UI 调整并发槽位

### Requirement: 平台 API 真实性仍为强约束
即使引入代理与 UI 事件，针对微信/抖音等平台 API 的真实性约束 MUST 不变：新增平台调用必须可追溯到官方文档或项目内类型定义；否则必须留 TODO 而非虚构 API。

#### Scenario: 缺少依据时不写入虚构 API
- **WHEN** 生成/修改涉及 `wx` 或 `tt` 的平台代码但缺少文档/类型依据
- **THEN** 实现 MUST 留空并标记 TODO，而不是写入虚构的方法名或参数

