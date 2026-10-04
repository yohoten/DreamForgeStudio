# studio-project-charter Specification

## Purpose
TBD - created by archiving change studio-meeting-charter-change-control. Update Purpose after archive.
## Requirements
### Requirement: 项目章程包含目标/里程碑/节点与版本
系统 SHALL 为每个 `projectId` 维护一份项目章程（Charter），字段至少包含：`goal`、`milestones[]`、`nodes[]`、`version`、`archivedAt?`。

#### Scenario: 读取章程
- **WHEN** UI 请求当前项目的章程
- **THEN** 服务端 SHALL 返回该 `projectId` 的当前章程草稿与最新归档版本（若存在）

### Requirement: 支持编辑章程草稿
系统 SHALL 允许老板在会议室内编辑章程草稿的目标/里程碑/节点。

#### Scenario: 保存章程草稿
- **WHEN** 老板在会议室修改章程并点击“保存草稿”
- **THEN** 服务端 SHALL 持久化草稿内容，并返回更新后的草稿

### Requirement: 支持归档章程版本
系统 SHALL 支持将草稿归档为新版本，并将版本号递增。

#### Scenario: 首次归档创建 v1
- **WHEN** 某 `projectId` 尚无归档章程且老板点击“归档”
- **THEN** 系统 SHALL 创建 `version=1` 的归档章程，并记录 `archivedAt`

#### Scenario: 再次归档创建 v2+
- **WHEN** 某 `projectId` 已有归档章程且老板点击“归档新版本”
- **THEN** 系统 SHALL 创建 `version=last+1` 的归档章程并追加到历史列表

