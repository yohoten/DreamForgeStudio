## ADDED Requirements

### Requirement: OpenAI-compatible 转发代理
系统 SHALL 暴露 OpenAI-compatible 的 `/v1/*` 路径，并将请求转发到可配置的上游 `baseURL`（例如 Ollama/vLLM/LM Studio）。

#### Scenario: 转发成功
- **WHEN** 客户端向 `http://<studio-server>/v1/chat/completions` 发送请求
- **THEN** 代理 SHALL 将请求转发到上游 `/v1/chat/completions`
- **AND THEN** 代理 SHALL 将上游响应返回给客户端

### Requirement: 记录 SSE 流式 chunk
当上游返回 SSE（`text/event-stream`）时，代理 SHALL 在转发的同时解析 `data:` 行，并产出 `llm.chunk` 与 `llm.message_done` 事件。

#### Scenario: 产生 chunk 事件
- **WHEN** 上游 SSE delta 中出现文本增量
- **THEN** 系统 SHALL 产出 `llm.chunk` 事件，payload 至少包含 `text`

### Requirement: 尽力映射 tool_calls
当上游 SSE delta 中出现 `tool_calls` 时，系统 SHALL 尽力映射为 `tool.start`/`tool.end` 事件；若上游不提供该字段，则该能力不强制。

#### Scenario: tool_calls 被映射
- **WHEN** 上游 delta 中包含 `tool_calls[].function.name`
- **THEN** 系统 SHALL 产出 `tool.start` 事件（包含 tool 名与可选 toolCallId）

### Requirement: 归因（可选）
系统 SHOULD 支持通过请求 metadata（例如 HTTP header）把事件归因到具体 `agentId` 与任务摘要；若客户端无法注入 metadata，系统 MUST 仍可记录事件但归因可缺失。

#### Scenario: 无归因也能记录
- **WHEN** 客户端未提供任何 agent 归因信息
- **THEN** 系统 SHALL 仍记录 `llm.*` 事件并可在 UI 展示

