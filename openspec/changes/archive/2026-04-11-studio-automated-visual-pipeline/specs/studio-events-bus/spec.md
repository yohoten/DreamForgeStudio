# studio-events-bus（变更增量）

## ADDED Requirements

### Requirement: 资产生命周期事件
当图像生成成功、spritesheet 生成成功或流水线失败时，系统 SHALL 发出专用事件类型（例如 `asset.image_saved`、`asset.spritesheet_saved`、`asset.pipeline_failed`），且事件 SHALL 包含 `projectId` 与关键路径或 `runId`。

#### Scenario: UI 可订阅
- **WHEN** 资产生成完成
- **THEN** WebSocket 订阅者 SHALL 能收到对应事件并解析 `payload`
