## Why

左侧 HUD 与抽屉叠在 Phaser 画布之上时，部分区域因 `pointer-events` 未正确命中，导致点击「穿透」到下层画布，触发拖拽/缩放而非预期 UI 操作。

## What Changes

- 为 `#hud` 顶栏 `.row` 显式开启 `pointer-events: auto`，避免标题与状态药丸区域穿透。
- 为抽屉遮罩与抽屉容器显式声明 `pointer-events: auto`，与层级一致，减少边缘穿透。

## Capabilities

### New Capabilities

（无独立新 capability；行为收敛在 `studio-web-ui`。）

### Modified Capabilities

- `studio-web-ui`：补充交互命中与层叠相关需求（见 delta spec）。

## Impact

- **代码**：`apps/studio-web/src/style.css` 仅样式调整。
- **行为**：顶栏与抽屉区域点击更稳定。
