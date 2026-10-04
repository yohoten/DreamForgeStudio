# studio-web-ui（变更增量）

## ADDED Requirements

### Requirement: 资产管线反馈（可选展示）
Studio Web MAY 在设置或显示器区域展示最近一次资产生成/拼接的摘要链接或状态文本；若未实现 UI，SHALL 至少可通过事件总线与 REST 查询结果（不阻塞本 change 验收）。

#### Scenario: 无 UI 时仍可验收
- **WHEN** 仅通过 API 与事件验证
- **THEN** 仍满足 `studio-image-generation` 与 `studio-spritesheet-pack` 的落盘要求
