## Context

`#hud` 使用 `pointer-events: none` 以便在「无控件」区域让事件落到画布用于平移；子元素需 `pointer-events: auto` 才能命中。全局 `.row` 曾设 `pointer-events: none`，且左侧 HUD 顶栏未再打开，导致穿透。

## Decisions

1. **hudStack**：用 `.hudStack` 包住顶栏与 `#inspector` 并设 `pointer-events: auto`，消除 flex 间隙与边距处的穿透（取代仅 `#hud > .row` 单点修补）。
2. **抽屉**：`.drawerMask`、`.drawer` 显式 `pointer-events: auto`，与 `z-index` 300/310 一致。
3. **Phaser**：`pointerdown` / `wheel` 前用 `document.elementFromPoint` 判断命中是否在 canvas 外 DOM，避免叠层时仍驱动画布。
4. **误选**：工位/房间/显示器/会议/小地图等 `pointerup` 在拖拽距离超过约 12～14px 时忽略，避免拖画布松手落在热点上误触发。

## Risks / Trade-offs

- 左栏整块 `hudStack` 为连续命中区，其矩形内空白也会拦截点到画布（与「左栏外才平移」一致）；顶栏高度有限，可接受。
