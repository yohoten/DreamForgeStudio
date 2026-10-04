# studio-video-asset-transcode（变更增量）

## ADDED Requirements

### Requirement: 可选自动转码为 WebM
若运行环境存在可用的 `ffmpeg`（PATH 或 `FFMPEG_PATH`），系统 SHALL 能将给定视频文件或帧序列自动转码为适合浏览器 `<video>` 播放的 WebM（或 MP4），并写入 `production/preview/<projectId>/assets/...`。

#### Scenario: ffmpeg 可用
- **WHEN** 调用转码 API 且 ffmpeg 执行成功
- **THEN** 输出文件 SHALL 存在于约定目录
- **AND THEN** 响应 SHALL 包含相对路径

#### Scenario: ffmpeg 不可用
- **WHEN** 系统中找不到 ffmpeg
- **THEN** 响应 SHALL 明确 `transcode: skipped` 或等价状态
- **AND THEN** 不得要求用户本地安装后再手动重试作为主路径（允许自动化重试其他策略或仅返回说明）
