## Why

Studio 已具备单文件预览、队列与基础事件流，但运营与迭代仍缺少「失败可一眼看懂」「预览可回溯与回滚」「密钥与配置不泄露」三类能力。本变更将后续路线图的第一阶段（稳定与可运营）落成可验收需求，并为后续工作流与多端扩展打地基。

## What Changes

- **失败可诊断总览**：在 Studio 侧聚合任务/事件中的失败信息（含关联 job id、阶段、可操作建议），避免仅靠散落日志排查。
- **预览历史与版本**：为 `production/preview/<projectId>/` 的生成结果保留可追溯历史（时间戳或版本号），支持在 UI 中选择历史版本并在 iframe 中预览，并提供「回滚到某版」的明确语义（覆盖当前预览文件或恢复为某快照）。
- **密钥与配置安全**：约定 API 密钥、代理地址等敏感配置的加载方式（环境变量/本地忽略文件），禁止写入仓库与客户端可下载产物；文档与默认模板对齐。
- **非目标（本 change 不承诺）**：多端小游戏新包体、完整 CI/CD、会议室/章程的深层改版（除非与上述三项直接冲突时再小步调整）。

## Capabilities

### New Capabilities

- `studio-failure-diagnostics`: 失败信息的结构化展示、与事件/任务 id 的关联、以及面向操作者的简短说明入口。
- `studio-preview-versioning`: 预览产物历史列表、版本选择与 iframe 预览、回滚/恢复语义与持久化位置约定。
- `studio-secrets-config`: 敏感配置的来源、禁止项、以及 Studio 服务端/前端读取约定（与现有 `local-llm-integration` 等协同）。

### Modified Capabilities

- `studio-web-ui`: 增加「失败总览」「预览历史/回滚」相关界面区域与状态展示（在不影响现有主流程的前提下）。
- `studio-events-bus`: 如失败诊断依赖事件字段，则补充事件 shape 或保留扩展字段的约定（仅当实现需要时）。

## Impact

- **代码**：`apps/studio-server`、`apps/studio-web`、`packages/shared`（事件类型与 API）、`production/preview/` 目录布局与可能的元数据文件。
- **配置**：`.env` / 本地配置示例、`.gitignore`、文档中的密钥说明。
- **运维**：本地与团队共享仓库时，需配合密钥不入库的流程。
