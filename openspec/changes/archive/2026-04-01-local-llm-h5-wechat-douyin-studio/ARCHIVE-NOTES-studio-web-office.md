# Studio Web 园区小人 / 寻路（与本 change 并行落地）

本目录变更 `local-llm-h5-wechat-douyin-studio` 侧重多平台 + 本地 LLM 骨架；**园区等距地图、工位摸鱼、公共设施往返、BFS 寻路、房门连通、头顶状态与 tween 串联**等在 `apps/studio-web/src/main.ts` 实现，未单独建 OpenSpec change。

归档日（2026-04-01）已确认行为可用要点：

- `staticBlocked` 与小人占格分离；寻路用 BFS，仅挡静态墙/房间地毯。
- `renderIsoRoom` 末尾打通门格四邻 `setStaticBlock(..., false)`，避免门在 4 邻网格上成孤岛。
- 移动用逐步 `tweens.add` + `onComplete`；`applyState` 在 `desk.moving` 时不覆盖头顶灯。
- 工位 `homeGx/homeGy`、出门公共设施、计时回座、`tickWander` 轮询等。

如需单独 spec，可从本笔记另起 `openspec/changes/<name>` 补 delta。
