## 1. 契约与事件

- [x] 1.1 在 `packages/shared` 的 `StudioEventType` 中增加 `asset.image_saved`、`asset.spritesheet_saved`、`asset.pipeline_failed`；`reduceState` 对资产生命周期事件无破坏性变更（可 no-op）
- [x] 1.2 在 `.env.example` 中补充 `STUDIO_IMAGE_BASE_URL`、`STUDIO_IMAGE_MODEL`、`STUDIO_IMAGE_API_KEY`（可选，可与 cloud 密钥二选一说明）

## 2. 图像生成与落盘

- [x] 2.1 新增 `POST /api/studio/assets/generate-image`：body 含 `projectId`、`prompt`、可选 `n`/`size`；服务端调用 OpenAI 兼容 `images/generations`；图片写入 `production/preview/<pid>/assets/gen/<runId>/`
- [x] 2.2 成功后广播 `asset.image_saved` 并返回 `runId` 与文件相对路径

## 3. Spritesheet

- [x] 3.1 新增 `POST /api/studio/assets/pack-spritesheet`：body 含 `projectId`、`runId`（或显式 `framePaths`）；使用 `sharp` 拼接并写 `manifest.json`
- [x] 3.2 成功后广播 `asset.spritesheet_saved`

## 4. 可选视频转码

- [x] 4.1 新增 `POST /api/studio/assets/transcode-video`：若存在 ffmpeg 则转码输入路径到 WebM；否则返回 `transcode: skipped`

## 5. 依赖与构建

- [x] 5.1 `apps/studio-server` 添加 `sharp` 依赖并通过 `npm run build`
