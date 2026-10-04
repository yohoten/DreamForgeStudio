## Context

已有 `studio-server`、队列、`production/preview/<projectId>/` 与事件总线。视觉管线必须 **100% 自动化**：不允许「设计师本地导出再上传」作为主路径。

## Goals / Non-Goals

**Goals:**

- 单一入口：`POST` API 由 Agent 或 UI 触发，服务端完成下载、拼合、写 manifest。
- 图像 API 可换源：默认按 **OpenAI 风格** `POST /v1/images/generations`；若上游不同，可用环境变量指向兼容网关或后续加薄适配层。
- spritesheet：输入为已落盘的等尺寸 PNG 列表（或目录内排序）；输出 `sheet.png` + `manifest.json`。
- 事件可观测：与 `job.finished` 类似，便于秘书/面板展示。

**Non-Goals:**

- 不在本阶段实现通用 ComfyUI 图节点编排 UI。
- 不保证所有环境都有 ffmpeg；无 ffmpeg 时视频类任务返回明确 `skipped` 或 `degraded`，不阻塞 PNG 流程。

## Decisions

1. **落盘布局**  
   `production/preview/<projectId>/assets/gen/<runId>/` 下放 `0.png`, `1.png`, … 与可选 `sheet.png`、`manifest.json`。

2. **图像生成实现**  
   使用 `fetch` + JSON，与现有 provider 密钥模式一致（环境变量/已有 `providerConfig` 中的 cloud key 可选复用）。若请求失败，记录 `job.failed` 风格事件或专用 `asset.failed`。

3. **spritesheet 实现**  
   依赖 `sharp` 做拼接与元数据读取；若未安装（极端情况），API 返回 `error: sharp_required` 并在文档说明。

4. **ffmpeg**  
   检测 `process.env.FFMPEG_PATH` 或 `ffmpeg` on PATH；调用 `ffmpeg -y ...` 写 WebM；失败则 payload 标明 `transcode: skipped`。

5. **与游戏迭代**  
   迭代 = 同一 `projectId` 多次调用生成与拼合；manifest 可被预览 HTML 内联脚本读取（相对路径），无需人手改图。

## Risks / Trade-offs

- [Risk] 上游图像 API 各异 → Mitigation：先 OpenAI 兼容一种，文档说明适配器。
- [Risk] sharp 在部分 Windows 环境构建慢 → Mitigation：预构建二进制，CI 验证 `npm install`。

## Migration Plan

- 新目录首次写入时 `mkdir` recursive；不影响旧预览 HTML。
- 无数据库迁移。

## Open Questions

- 是否将「图像任务」纳入现有 `Job` 队列与 `runJob` 统一调度（后续迭代）。
