## 1. Monorepo 基础与共享类型

- [x] 1.1 建立 monorepo 目录：`apps/studio-server`、`apps/studio-web`、`packages/shared`
- [x] 1.2 在 `packages/shared` 定义事件 envelope、事件类型、以及 UI 状态机推导（reduceState）
- [x] 1.3 增加 `.gitignore`：忽略 `studio_events.jsonl` 与依赖/构建产物

## 2. 事件总线（JSONL + WS）

- [x] 2.1 `studio-server` 实现 JSONL 追加写入（单行 JSON）
- [x] 2.2 `studio-server` 实现 WebSocket fanout（所有事件实时广播）
- [x] 2.3 提供 tail API（最近 N 行事件回放）用于 UI 冷启动恢复
- [x] 2.4 增加仓库文件监听（fs.change），并写入事件总线

## 3. OpenAI-compatible 代理（可观测边界）

- [x] 3.1 增加 `/v1/*` 转发到可配置 `STUDIO_UPSTREAM_BASE_URL`
- [x] 3.2 SSE 解析：将 `delta.content` 映射为 `llm.chunk`，并在 `[DONE]` 产生 `llm.message_done`
- [x] 3.3 尽力解析 `delta.tool_calls` 产出 `tool.start/tool.end`
- [x] 3.4 文档化 Cursor/客户端接入（baseURL 指向 `http://127.0.0.1:8787/v1`）

## 4. Studio Web UI（办公室 + 工位）

- [x] 4.1 用 Phaser 渲染办公室地图，加载 Agent 列表并生成工位
- [x] 4.2 实现相机交互：拖拽平移、滚轮缩放、小地图点击跳转
- [x] 4.3 工位状态：按事件流更新状态图标与气泡；事件面板显示摘要
- [x] 4.4 32px tile 占位像素风皮肤（runtime 纹理或 spritesheet）

## 5. 房间系统（基础）

- [x] 5.1 定义房间列表与锁定/开放状态并展示在地图上
- [x] 5.2 UI：选中 Agent → 点击房间派遣 → 本地动画反馈
- [x] 5.3 服务端：提供 `POST /api/emit` 注入 `room.enter/room.leave` 等事件以同步多客户端

## 6. 招聘 / ComputeSlots / 优先级队列（基础）

- [x] 6.1 服务端：ComputeSlots 配置 API（默认 1，允许 1–8）
- [x] 6.2 服务端：雇佣名单门禁（空名单不限制；非空只允许对已雇佣派单）
- [x] 6.3 服务端：任务队列 enqueue API（priority + FIFO）与调度器（按 ComputeSlots 运行）
- [x] 6.4 事件：产出 `job.enqueued/job.started/job.finished` 并驱动 Agent 状态更新
- [x] 6.5 上游不可用降级：代理/上游失败时仍可用模拟输出推进队列

## 7. 体检（粗测）与扩展点

- [x] 7.1 增加 `/api/bench` 粗测首包延迟与可用性（stream 基线）
- [x] 7.2 预留阶梯并发压测（1/2/4/8）接口与 UI 展示（后续迭代）

## 8. 技术科普可视化（本地 vs API）

- [x] 8.1 UI：基于 `providerId` 实现“金币扣费/电费图标”飘字特效（外部 API 扣费可见、本地模型提示可见）
- [x] 8.2 UI：秘书播报（中文）——任务完成时输出 tokens/费用估算、本月累计与操作建议
- [x] 8.3 UI：算力等级（S/A/B/C）展示——由设备 profile + bench 结果推导，并同步推荐 ComputeSlots / provider
- [x] 8.4 服务端：可选“自动外包”开关与策略——本地不可用/延迟过高/队列积压时，新任务自动切换到外部 API provider（必须可关闭）
- [x] 8.5 OpenSpec：明确 provider 归因字段（`job.started.payload.providerId`）与财务汇总/建议 API 的用途（用于 UI 可视化与播报）

