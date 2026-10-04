# studio-preview-versioning（变更增量）

## ADDED Requirements

### Requirement: 预览成功生成后保留历史版本
当系统向 `production/preview/<projectId>/index.html` 写入新的预览内容时，系统 SHALL 在此之前将当前可运行版本保留为历史条目（除非不存在上一版本），并在 manifest 中登记。

#### Scenario: 连续两次生成产生两条历史
- **WHEN** 同一 `projectId` 连续两次成功生成预览
- **THEN** manifest SHALL 至少包含两条可区分的历史条目（时间戳或单调 id）
- **AND THEN** 当前主入口 `index.html` SHALL 始终指向最新一次成功写入的内容

### Requirement: 可列举历史并回滚
系统 SHALL 提供只读 API 列出某 `projectId` 的预览历史摘要；并 SHALL 提供将指定历史版本恢复为当前主 `index.html` 的操作（受权限与确认约束，本地开发可为同源即可）。

#### Scenario: 列出历史
- **WHEN** 客户端请求历史列表 API
- **THEN** 响应 SHALL 包含按时间倒序的条目（含 `id` 与 `savedAt` 或等价字段）

#### Scenario: 回滚后 iframe 预览一致
- **WHEN** 用户选择某历史版本执行回滚
- **THEN** 主 `index.html` 内容 SHALL 与该历史版本一致
- **AND THEN** 预览 iframe 重新加载后 SHALL 显示回滚后的页面

### Requirement: 历史文件位置约定
历史版本文件 SHALL 存放在 `production/preview/<projectId>/` 下的专用子目录中，且 MUST NOT 将密钥写入这些 HTML 文件以外的未跟踪敏感文件路径之外的意外位置（遵循 `studio-secrets-config`）。

#### Scenario: 仓库结构可预测
- **WHEN** 贡献者查看仓库
- **THEN** 文档或 manifest 路径 SHALL 能说明 `versions/`（或等价名）用途
