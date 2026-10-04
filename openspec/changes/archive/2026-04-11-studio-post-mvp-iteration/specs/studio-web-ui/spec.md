# studio-web-ui（变更增量）

## ADDED Requirements

### Requirement: 最近失败总览区域
Studio Web UI SHALL 提供「最近失败」总览（可为侧栏、抽屉或面板），展示来自事件或汇总 API 的失败条目，并支持复制关联标识。

#### Scenario: 失败列表可见
- **WHEN** 存在至少一条 `job.failed`（或等价失败事件）
- **THEN** UI SHALL 在总览区域展示对应条目（含时间与摘要）

#### Scenario: 无失败时不遮挡主流程
- **WHEN** 不存在失败记录
- **THEN** UI MAY 折叠或显示空状态，而不遮挡招聘/派单主面板

### Requirement: 预览历史与回滚入口
Studio Web UI SHALL 提供当前项目的预览历史列表（或链接至预览页内的历史控件），并允许用户触发「回滚到该版本」（需确认）。

#### Scenario: 选择历史版本
- **WHEN** 用户展开预览历史
- **THEN** UI SHALL 列出可选版本标识（时间或标签）
- **WHEN** 用户确认回滚
- **THEN** UI SHALL 调用服务端回滚 API 并在成功后刷新预览 iframe
