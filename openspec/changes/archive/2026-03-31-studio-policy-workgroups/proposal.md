## Why

当前 Studio 已经能“看见”Agent 的在岗/派单/成本，但要让工作室像模拟经营一样**自动运转**，还缺少两类关键能力：

- **管理策略系统**：让制作人/技术总监/创意总监以“策略配置”驱动拆单、派单、验收与降级（规则模式为主，模型增强为辅），形成可玩且可控的自动化闭环。
- **多工作组/多项目并行**：把“算力/并发槽位”映射成可同时推进的项目数量，让用户通过升级算力与策略配置获得真正的经营成长曲线。

## What Changes

- 新增“管理策略面板”：制作人/技术总监/创意总监三岗的策略配置（规则模式默认 + 可选模型增强），并影响队列优先级、provider 选择、重试与验收门禁。
- 新增“部门显示器/验收工单”：每个部门区域都有显示器入口，展示部门产出/问题/卡点，并提供“通过/驳回/继续(重做)”操作，触发对相关岗位的派单。
- 新增“工作组/项目”概念：一个工作组对应一个项目产出（最小为 HTML 单文件预览），支持多工作组并行；可并行数量受算力/ComputeSlots/策略约束。
- 扩展“预览显示器”：从单一预览升级为按 `projectId` 的预览与保存（例如 `GET /preview?projectId=...`，`POST /api/preview/save` 支持 projectId）。
- 扩展统计：为每个部门/项目提供更可解释的进度指标（产出文件、对话输出、失败/错误、阻塞人数、是否需要老板介入）。

## Capabilities

### New Capabilities

- `studio-policy-system`: 三总监（制作人/技术总监/创意总监）的策略配置、规则执行与（可选）模型增强入口，影响拆单/派单/provider/重试/验收门禁。
- `studio-dept-monitors`: 部门显示器与验收工单（产出/问题/卡点/老板介入提示 + 通过/驳回/重做动作），并与队列/事件联动。
- `studio-workgroups-projects`: 工作组/项目模型（项目列表、并行上限、项目状态、项目归因），把“算力”映射为可并行项目数。
- `studio-preview-sandbox`: 项目产出预览与保存（按 projectId），支持在 UI 中打开预览、保存 HTML、刷新与统计展示。

### Modified Capabilities

- `studio-hiring-queue`: 增补“按策略自动派单/重试/降级”的需求，以及“工作组/项目”的归因字段（job 与 projectId/workgroupId 关联）。
- `studio-events-bus`: 增补项目/验收/策略相关事件字段的最小约定（例如 projectId/workgroupId、review.action、policy.decision 等）。
- `studio-web-ui`: 增补部门显示器/项目显示器的交互与 UI 结构（不改变既有相机/等距沙盘的核心交互）。

## Impact

- **服务端**：新增/扩展 API（policy、projects/workgroups、preview 按 projectId、统计聚合）；队列调度需要理解策略与项目归因。
- **Web UI**：新增策略面板/部门工单 UI；场景中增加部门与项目显示器物件；预览弹窗支持多项目切换。
- **共享类型**：需要补充 project/workgroup/policy/review 相关事件与状态字段（保持兼容旧事件）。

