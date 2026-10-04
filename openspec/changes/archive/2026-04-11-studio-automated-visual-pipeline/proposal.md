## Why

工作室目标是无人工介入的端到端自动化：已开发项目需可迭代；美术资源需由 Agent 触发真实出图，并在服务端完成落盘与衍生处理。此前仅有 LLM 文本与 HTML 预览闭环，缺少「可验收的视觉资产管线」。本变更将**全自动**的图片生成、帧拼合与可选视频转码纳入 Studio，不包含依赖人手导出/压片的步骤。

## What Changes

- **图像生成**：由 `studio-server` 统一调用可配置的图像生成 HTTP API（OpenAI 兼容 `images/generations` 或适配器约定），将结果写入 `production/preview/<projectId>/assets/`，并发出事件。
- **自动 spritesheet**：对同一任务产生的多帧 PNG（或指定路径列表）在服务端自动拼接为单张 spritesheet，并写出 `manifest.json`（帧尺寸、行列、资源 URL 相对路径）。
- **可选视频资产**：若环境提供 `ffmpeg`（或后续可选依赖），可将短视频/帧序列自动转码为 WebM/MP4 落盘；不可用则任务明确降级或跳过，不要求人工处理。
- **迭代契约**：资产与 manifest 均绑定 `projectId`，便于同一预览项目内多轮任务覆盖或追加。

## Capabilities

### New Capabilities

- `studio-image-generation`：服务端图像生成调用、鉴权、落盘路径约定、失败与脱敏。
- `studio-spritesheet-pack`：多图自动拼接与 manifest 生成，全脚本化。
- `studio-video-asset-transcode`：可选 ffmpeg 转码为浏览器可播格式，失败时可自动降级说明。

### Modified Capabilities

- `studio-events-bus`：增加与资产生命周期相关的事件类型（如生成完成、拼接完成）。
- `studio-web-ui`：可选展示「最近生成的资产」或链接（不阻塞主流程）。

## Impact

- **代码**：`apps/studio-server`（新路由、可选 `sharp`、可选 `child_process` 调用 ffmpeg）、`packages/shared`（事件类型）、`production/preview/*/assets/` 目录约定。
- **依赖**：Node 侧图像处理（计划使用 `sharp`）；ffmpeg 为可选系统依赖。
- **配置**：环境变量中的图像 API Base URL 与密钥（沿用 `.env`，不入库）。
