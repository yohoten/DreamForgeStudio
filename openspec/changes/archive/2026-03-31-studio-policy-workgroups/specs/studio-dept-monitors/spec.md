## ADDED Requirements

### Requirement: 每个部门都有显示器入口
UI SHALL 在每个部门分区提供一个可点击的显示器入口，用于打开“部门看板/验收工单”。

#### Scenario: 打开部门看板
- **WHEN** 用户点击某部门显示器
- **THEN** UI SHALL 打开该部门的看板，并显示该部门的产出/问题/卡点摘要

### Requirement: 部门看板展示可解释指标
系统 SHALL 为部门看板提供可解释的指标：产出、问题数、卡点与“是否需要老板介入”的提示。

#### Scenario: 指标更新
- **WHEN** 系统产生新的事件（fs.change/job/tool/llm 等）
- **THEN** 部门看板的指标 SHALL 随事件流更新（允许节流）

### Requirement: 验收工单动作（通过/驳回/重做）
部门看板 SHALL 提供“通过/驳回/继续(重做)”动作，并将动作转化为可执行派单（job 入队）以驱动部门继续工作。

#### Scenario: 驳回触发重做
- **WHEN** 用户在部门看板点击“驳回”
- **THEN** 系统 SHALL 生成一条带问题清单与修复步骤要求的任务入队
- **AND THEN** 该任务 SHOULD 优先派给该部门的相关岗位（无可用时兜底给制作人）

