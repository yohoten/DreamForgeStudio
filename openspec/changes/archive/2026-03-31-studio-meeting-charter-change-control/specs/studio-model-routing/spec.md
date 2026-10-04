## ADDED Requirements

### Requirement: 提供会议模型与执行模型的简单配置
系统 SHALL 提供“游戏化三档”的模型路由配置，用于决定会议/执行时默认使用的 provider。

#### Scenario: 选择三档策略
- **WHEN** 用户在策略/设置中选择“省钱/均衡/高质量”
- **THEN** 系统 SHALL 更新模型路由配置（至少影响：会议默认 provider、执行默认 provider）

### Requirement: 会议默认使用强模型 provider
系统 SHALL 默认将会议室（立项/变更会）相关的生成与总结任务路由到强模型 provider（通常为 cloud）。

#### Scenario: 会议路由到 cloud
- **WHEN** 用户未对会议模型做特殊覆盖
- **THEN** 系统 SHALL 使用 `meetingProviderId=cloud` 执行会议相关任务

### Requirement: 三总监默认跟随会议模型
系统 SHALL 默认让制作人/技术总监/创意总监的建议/总结类任务跟随会议模型 provider。

#### Scenario: 三总监跟随会议
- **WHEN** 三总监在会议室生成建议
- **THEN** 系统 SHALL 使用 `meetingProviderId` 而不是执行默认 provider

### Requirement: 其他岗位默认使用执行模型
系统 SHALL 默认让非三总监岗位的执行型任务使用执行默认 provider（通常为 local）。

#### Scenario: 执行任务路由到 local
- **WHEN** 普通岗位入队执行型任务且未被个体覆盖
- **THEN** 系统 SHALL 使用 `executionProviderId=local`

### Requirement: 个体覆盖仅提供 providerId 级别选择
系统 SHALL 允许对单个员工（agent）设置 provider 覆盖，但覆盖层级仅限 providerId（不允许在员工层面配置 baseUrl/apiKey）。

#### Scenario: 员工覆盖 cloud
- **WHEN** 用户为某个 agent 设置 provider 覆盖为 cloud
- **THEN** 该 agent 的任务 SHALL 使用 cloud（除非更高优先级规则另有规定）

