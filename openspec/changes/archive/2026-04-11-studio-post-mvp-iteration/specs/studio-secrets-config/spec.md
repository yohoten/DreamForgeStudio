# studio-secrets-config（变更增量）

## ADDED Requirements

### Requirement: 敏感配置仅通过环境或本地未跟踪文件
Studio 服务端 SHALL 从 `process.env`（及可选的本地 `.env`，且不提交仓库）读取上游 URL、API Key 等敏感配置；仓库中 SHALL 提供 `.env.example` 列出键名与占位值。

#### Scenario: 克隆仓库后无密钥泄漏
- **WHEN** 新贡献者仅克隆仓库且不创建本地 `.env`
- **THEN** 默认示例文件 SHALL NOT 包含真实密钥字符串

### Requirement: 日志与事件脱敏
任何将 HTTP 头或代理请求写入日志或事件的代码路径 MUST 对 `Authorization` 及 Bearer token 做脱敏处理。

#### Scenario: 调试日志安全
- **WHEN** 服务端记录一次失败的 OpenAI-compatible 请求
- **THEN** 日志行 SHALL NOT 包含完整密钥

### Requirement: 前端不承载密钥
Studio Web 构建产物 MUST NOT 包含 API Key；浏览器侧 SHALL 仅通过同源服务端转发调用模型端点。

#### Scenario: 构建检查
- **WHEN** 审查 `apps/studio-web` 分发文件
- **THEN** 不应出现硬编码的长随机密钥字符串（与 `local-llm-integration` 一致）
