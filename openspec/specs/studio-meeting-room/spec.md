# studio-meeting-room Specification

## Purpose
TBD - created by archiving change studio-meeting-charter-change-control. Update Purpose after archive.
## Requirements
### Requirement: 场景中提供会议室入口
系统 SHALL 在 Web 沙盘场景中提供一个可点击的“会议室”物件入口，用于打开立项/变更会面板。

#### Scenario: 点击会议室打开面板
- **WHEN** 用户点击会议室物件
- **THEN** 系统 SHALL 打开“会议室”弹窗/抽屉，并锁定场景输入（避免误操作）

### Requirement: 会议室支持立项讨论与拍板
系统 SHALL 支持老板发起立项讨论，并让制作人/技术总监/创意总监给出建议，老板做出决策。

#### Scenario: 发起立项
- **WHEN** 老板在会议室输入立项主题并点击“开始立项”
- **THEN** 系统 SHALL 生成一次会议记录（meeting），并展示三总监的建议区域（可为规则生成或模型生成）

#### Scenario: 老板拍板立项
- **WHEN** 老板在会议室点击“立项通过”
- **THEN** 系统 SHALL 生成章程草稿（见 `studio-project-charter`）并进入“待归档”状态

### Requirement: 会议室支持变更会（基于偏离提醒）
系统 SHALL 支持在发现章程偏离时，通过会议室发起“变更会”以确认并归档新版本。

#### Scenario: 打开变更会
- **WHEN** 系统存在待确认的章程变更记录
- **THEN** 会议室面板 SHALL 显示“待确认变更”入口与摘要（变更类型：目标/里程碑/节点）

#### Scenario: 变更会确认并归档
- **WHEN** 老板在变更会中确认变更并点击“归档新版本”
- **THEN** 系统 SHALL 创建新的章程版本并标记为已归档（见 `studio-change-control`）

