## ADDED Requirements

### Requirement: 项目与工作组模型
系统 SHALL 引入项目（project）与工作组（workgroup）概念，用于表示同时推进的多个游戏/产出流。

#### Scenario: 创建默认项目
- **WHEN** Studio 首次启动且未配置任何项目
- **THEN** 系统 SHALL 创建一个默认项目（例如 `project_1`）并允许派单归因到该项目

### Requirement: 并行项目数受算力/策略约束
系统 SHALL 限制可同时处于“进行中”的项目数量，上限由算力评估/策略配置决定（与 ComputeSlots 区分）。

#### Scenario: 低算力限制为单项目
- **GIVEN** 算力等级较低或策略限制并行项目数为 1
- **WHEN** 用户尝试启动第二个项目的工作组
- **THEN** 系统 SHALL 阻止该项目进入“进行中”，并提示需要升级算力或调整策略

### Requirement: Job 归因到 projectId/workgroupId
系统 SHALL 支持将任务（job）归因到 projectId/workgroupId，用于 UI 聚合与部门验收。

#### Scenario: 入队携带归因
- **WHEN** 用户/策略系统入队一条任务并指定 `projectId`/`workgroupId`
- **THEN** 系统 SHALL 保存该归因，并在 `job.started`/`job.finished` 事件中携带该字段

