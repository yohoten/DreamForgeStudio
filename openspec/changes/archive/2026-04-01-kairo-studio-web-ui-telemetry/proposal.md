## Why

当前仓库已经具备「开罗风工作室」的雏形（工位、房间、状态气泡、事件时间线），但缺少一个**面向使用者的契约**来回答：哪些能力必须稳定可用、事件从哪里来、如何对接本地/局域网/互联网模型、以及“雇佣/并发/队列”这一主循环如何约束实现。需要用 OpenSpec 把它固化，便于后续迭代（素材替换、付费解锁、跨端输出）不走样。

## What Changes

- 新增 **Studio Web UI**：浏览器内的像素风办公室视图，展示 Agent 工位、状态图标、气泡与事件面板（可拖拽平移、滚轮缩放、小地图跳转）。
- 新增 **可观测边界**：一个 OpenAI-compatible `/v1/*` 代理与事件总线，把 LLM 流式输出、（可选）tool_calls、文件变更统一写入事件并通过 WebSocket 分发。
- 新增 **房间系统（基础版）**：会议室/咖啡室/健身室等区域与锁定状态；选中 Agent 可派遣进入房间并广播事件。
- 新增 **招聘/队列（基础版）**：ComputeSlots（串行/并行槽位）、雇佣名单、任务队列与优先级调度；队列驱动 Agent 进入“工作中”状态并产生事件。
- 新增 **体检（粗测）**：对当前上游端点做最小 stream 体验测试，作为后续阶梯压测与推荐并发的基础。
- 新增 **“技术科普可视化”（MVP）**：用开罗 45° 沙盘把本地模型 vs 外部 API 的差别可视化（金币扣费/电费图标/秘书播报/算力等级），并给出“自动外包”建议与开关。

## Capabilities

### New Capabilities

- `studio-web-ui`: 开罗风工作室 Web UI（工位/分区/相机控制/小地图/房间交互/招聘派单面板）。
- `studio-events-bus`: 事件协议与事件总线（JSONL/WS 分发、事件 envelope、客户端状态机推导）。
- `openai-compat-proxy-logging`: OpenAI-compatible 代理（转发 `/v1/*`，记录 SSE chunk 与可选 tool_calls，并生成事件）。
- `studio-hiring-queue`: 招聘/并发槽位/优先级队列（串行默认，支持小并行），并与事件联动。

### Modified Capabilities

- `local-llm-integration`: 增补“可观测边界/代理接入”的工作流约束与说明（从仅文档约束扩展到可运行的日志/事件接入）。

## Impact

- **新增 Node/TS 运行时与依赖**：monorepo（`apps/studio-server`、`apps/studio-web`、`packages/shared`）。
- **新增本地端口**：`8787`（server/ws/proxy）、`5173`（web dev server）。
- **新增事件日志文件**：`studio_events.jsonl`（gitignore）。
- **对使用者的影响**：需要把 OpenAI-compatible 客户端（如 Cursor）`baseURL` 指向本地代理，才能看到完整 LLM 流事件；若无法注入 header，事件仍可展示但归因能力下降。

