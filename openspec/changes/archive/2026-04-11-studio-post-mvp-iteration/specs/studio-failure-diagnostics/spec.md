# studio-failure-diagnostics（变更增量）

## ADDED Requirements

### Requirement: 失败事件可关联任务与会话
系统 SHALL 在任务失败时发出可机器解析的事件，且 payload SHALL 包含 `correlationId`，并 SHOULD 包含 `jobId`（或等价标识）与 `stage`（例如 `queue`/`proxy`/`render`）。

#### Scenario: 失败可被订阅者识别
- **WHEN** 某次生成或代理请求失败
- **THEN** 事件总线 SHALL 追加一条类型为 `job.failed`（或与现有失败类型统一后的单一类型）的事件
- **AND THEN** 该事件的 `payload` SHALL 包含人类可读 `message` 与 `correlationId`

### Requirement: Studio Web 可展示最近失败总览
Studio Web UI SHALL 提供「最近失败」区域，列出至少最近若干条失败摘要（时间、阶段、摘要信息、可复制的关联 id）。

#### Scenario: 用户看到失败而不必翻 JSONL
- **WHEN** 用户打开 Studio Web 并保持连接或刷新后拉取 tail
- **THEN** UI SHALL 在专用区域展示最近失败列表（条目数有上限亦可）
- **WHEN** 用户点击复制关联 id
- **THEN** UI SHALL 将 `correlationId` 或 `jobId` 复制到剪贴板（在可用环境中）

### Requirement: 敏感信息不进入失败 payload
失败事件的 `message` 与任何日志字段 MUST NOT 包含完整 API 密钥或 `Authorization` 原文。

#### Scenario: 上游返回 401
- **WHEN** 上游因密钥错误返回 401/403
- **THEN** 记录或展示的错误文本 SHALL 仅描述状态码与脱敏提示，不包含密钥内容
