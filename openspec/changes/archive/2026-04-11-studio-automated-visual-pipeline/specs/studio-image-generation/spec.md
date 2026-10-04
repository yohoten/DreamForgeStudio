# studio-image-generation（变更增量）

## ADDED Requirements

### Requirement: 服务端发起图像生成并落盘
系统 SHALL 提供仅服务端可调用的图像生成能力：向可配置的 OpenAI 兼容 `images/generations` 端点发起请求，将返回的图片保存到 `production/preview/<projectId>/assets/gen/<runId>/` 下，文件名 SHALL 为可排序的 `0.png`, `1.png`, …（或等价前缀）。

#### Scenario: 成功保存至少一张图
- **WHEN** 客户端以合法 `projectId` 与 `prompt` 调用生成 API
- **THEN** 磁盘上 SHALL 出现至少一个图像文件
- **AND THEN** 响应 SHALL 包含 `runId` 与相对仓库根的资源路径列表

### Requirement: 密钥不暴露给浏览器
图像生成请求 SHALL 仅在服务端携带 API 密钥；浏览器 SHALL NOT 获得明文密钥。

#### Scenario: 仅同源调用
- **WHEN** Studio Web 触发生成
- **THEN** 请求 SHALL 发往同源 `studio-server`，由服务端转发上游

### Requirement: 失败可观测且脱敏
失败时系统 SHALL 发出可记录的事件或错误响应，且 MUST NOT 在 payload 中包含完整 API 密钥。

#### Scenario: 上游不可用
- **WHEN** 上游返回非 2xx 或网络错误
- **THEN** 调用方 SHALL 收到结构化错误信息（无密钥原文）
