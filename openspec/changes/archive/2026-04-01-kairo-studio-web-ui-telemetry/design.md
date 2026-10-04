## Context

本仓库当前实现了一套可运行的 Studio 原型：

- `apps/studio-server`：事件总线（JSONL + WS fanout）+ 仓库文件监听（fs.change）+ OpenAI-compatible `/v1/*` 转发代理（记录 SSE chunk / 可选 tool_calls）+ UI 事件注入 `/api/emit`。
- `apps/studio-web`：开罗风办公室 UI（32px tile 占位像素风、分区、相机平移缩放、小地图、房间交互）+ 右侧“招聘/派单”面板（ComputeSlots、雇佣名单、队列入队、粗测 bench）。
- `packages/shared`：统一事件 envelope 与 UI 状态机推导（reduceState）。

约束与现实：

- Cursor/多数 IDE 并不会把内部对话流直接暴露给网页，所以要实现“方案 B 的实时事件”，必须通过 **可观测边界**（代理/编排入口）来采集流式输出与工具信息。
- 本阶段以 **Web/H5** 为主交付面；引擎（Unity/UE/Godot）适配只做方法论层复用，不在本变更内承诺“直接接入编辑器工作流”。 

## Goals / Non-Goals

**Goals:**

- 统一事件契约：Agent 状态、房间事件、队列事件、LLM 流事件，都通过同一 envelope 产出与消费。
- 形成稳定的可观测边界：OpenAI-compatible 代理与事件总线提供“最小可用的实时性”，支持 UI 订阅与回放（tail）。
- 支持“默认串行 + 可选小并行”的雇佣与调度：ComputeSlots（1–8）限制并发；优先级队列驱动 Agent 的忙碌状态与可视化。
- 为后续“经营玩法”留接口：房间锁定/解锁、房间效果、成本核算、秘书/Producer 排程，都基于事件与队列扩展即可。

**Non-Goals:**

- 不实现完整 IDE（代码编辑、调试、Git GUI 等）。
- 不保证对 Unity/UE/Godot 的一键接入与构建导出。
- 不做真实付费系统（只做可锁定/可解锁的抽象与 UI 表达）。
- 不要求 tool 调用在所有客户端都可见（若客户端不输出 tool_calls，则仅能通过 runner/脚本约定补齐）。

## Decisions

1. **事件存储与分发：JSONL + WS（先）**
   - 选择 JSONL 作为落盘格式：易追加、易 tail、易调试。
   - 选择 WS 作为分发：UI 订阅简单；后续可替换为 SSE/消息队列但不改事件 schema。
   - 备选：SQLite。后续在需要复杂查询/统计/存档时切换。

2. **OpenAI-compatible 代理作为“可观测边界”**
   - 代理路径为 `studio-server` 的 `/v1/*`：对客户端透明，便于把任何 OpenAI-compatible 客户端纳入事件体系。
   - 对 SSE 数据做“轻解析”：提取 `delta.content` 作为 `llm.chunk`；提取 `delta.tool_calls` 映射为 `tool.start/tool.end`（尽力而为）。
   - 备选：直接改 IDE/壳。成本高、耦合强，放到后续大版本。

3. **雇佣与并发：ComputeSlots + 优先级队列**
   - 将“雇佣人数”定义为**可派单岗位数**与**可并发槽位数**的组合：默认槽位 1（串行），小并行由 bench/用户手动调高。
   - 队列调度规则：按 `priority DESC`，同优先级按创建时间 FIFO。
   - 备选：复杂多队列/抢占式调度。后续通过事件与状态机扩展。

4. **UI：先可玩，再换皮**
   - 32px tile 为基准；占位像素风纹理通过 Phaser runtime 生成，后续可替换为 spritesheet 而不改交互逻辑。
   - 房间系统先提供“区域/锁定/派遣/事件”闭环，效果与付费在后续加。

5. **“技术科普可视化”作为第一等 UI 反馈**
   - 将“本地模型 vs 外部 API”的抽象知识点转成沙盘内的可见反馈：外部 API = 金币扣费，本地模型 = 电费/显存图标。
   - 增加“秘书播报”作为面向新手的解释层：在任务完成/成本变化时输出中文摘要（tokens/费用/建议）。
   - 引入“算力等级（S/A/B/C）”作为粗粒度导览：由设备 profile + bench 粗测得出，驱动 ComputeSlots 与 Provider 推荐。
   - 自动外包（auto-route）作为可选策略：当本地不可用/延迟过高/队列积压时，将新任务自动切换到外部 API，并在 UI 明确解释原因与成本影响。

## Risks / Trade-offs

- [Risk] 上游模型端点不可用或不支持 SSE → Mitigation：队列执行降级为模拟输出，保证玩法闭环不崩。
- [Risk] IDE 无法注入自定义 header（Agent 归因困难） → Mitigation：允许 UI 侧手动指定 Agent，或由队列/派单系统生成归因。
- [Risk] 高频 chunk 造成 UI 卡顿 → Mitigation：UI 合并/节流（已做基础节流），后续按相关性聚合事件。
- [Trade-off] 先内存队列（server 重启丢失） → Mitigation：后续用 JSONL/SQLite 做持久化与重放恢复。

## Migration Plan

- 本变更仅新增 Studio 子项目与文档，不影响现有 openspec `local-llm-h5-wechat-douyin-studio` 交付面。
- 运行方式：`npm install && npm run dev`。
- 回滚：删除 `apps/studio-server`、`apps/studio-web`、`packages/shared`，以及相关文档与 `.gitignore` 追加项即可。

## Open Questions

- bench 的最终口径：以 tok/s、首 token 延迟、并发稳定性、还是“任务 SLA（完成时间）”作为雇佣上限的主要依据？
- 成本模型：按 tokens、按时间、按功耗估算、还是按“服务商标价”混合？
- 房间效果如何影响真实工作流：纯视觉/数值玩法，还是也影响调度（例如会议室自动提高优先级/减少错误重试）？

