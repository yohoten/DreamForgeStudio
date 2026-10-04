## ADDED Requirements

### Requirement: 归档后修改触发偏离检测
系统 SHALL 在存在“最新归档章程”的前提下，对章程草稿执行偏离检测：只要 `goal`、`milestones`、`nodes` 任一发生变化，即判定为偏离。

#### Scenario: 目标变化触发偏离
- **WHEN** 草稿 `goal` 与最新归档版本不同
- **THEN** 系统 SHALL 生成一条变更记录（change record），类型为 `goal_changed`

#### Scenario: 里程碑变化触发偏离
- **WHEN** 草稿 `milestones` 与最新归档版本不同（新增/删除/重排/文本变化）
- **THEN** 系统 SHALL 生成一条变更记录，类型为 `milestones_changed`

#### Scenario: 节点变化触发偏离
- **WHEN** 草稿 `nodes` 与最新归档版本不同（新增/删除/重排/文本变化）
- **THEN** 系统 SHALL 生成一条变更记录，类型为 `nodes_changed`

### Requirement: 秘书提示偏离并引导变更会
系统 SHALL 在偏离发生时，通过秘书通知提示“偏离已归档章程”，并引导用户进入会议室确认变更并归档新版本。

#### Scenario: 偏离触发通知
- **WHEN** 系统生成新的变更记录
- **THEN** 系统 SHALL 向 UI 推送通知/事件，包含 `projectId`、归档版本号与变更类型

### Requirement: 变更记录可被确认并清空
系统 SHALL 支持用户在变更会中确认变更，归档新版本后将对应变更记录标记为已处理。

#### Scenario: 归档后清空待确认变更
- **WHEN** 用户在变更会中归档新版本成功
- **THEN** 系统 SHALL 将该 `projectId` 的待确认变更记录标记为已处理（或清空）

### Requirement: 偏离提醒需节流
系统 SHALL 对偏离提醒进行节流，避免频繁弹窗刷屏。

#### Scenario: 30 秒内合并提醒
- **WHEN** 同一 `projectId` 在 30 秒内产生多次偏离
- **THEN** 系统 SHALL 合并为一条提示（或只更新计数），而不是重复弹出多条通知

