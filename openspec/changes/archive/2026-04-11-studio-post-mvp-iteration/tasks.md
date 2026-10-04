## 1. 契约与共享类型

- [x] 1.1 在 `packages/shared` 为 `StudioEventType` 增加 `job.failed`，并在 `reduceState` 中将该事件映射为 Agent `error`（或保留 `blocked`+摘要，以不破坏现有气泡逻辑为准）
- [x] 1.2 导出失败 payload 字段约定（`jobId`、`stage`、`message`、`hint`）供服务端与 UI 共用

## 2. studio-server：失败事件与只读汇总

- [x] 2.1 在 `runJob` 两条失败路径上于 `job.finished`（`ok: false`）之前发出 `job.failed`，`message` 经脱敏（无 Bearer/长 hex 密钥）
- [x] 2.2 新增 `GET /api/studio/failures?limit=`：从 `studio_events.jsonl` 尾部解析，返回最近若干条 `job.failed` 与（兼容）`job.finished` 且 `payload.ok === false` 的条目
- [x] 2.3 新增 `POST /api/preview/restore`：校验 `projectId` 与 `file`（仅 `history/` 下已有 `.html`），将内容写回 `index.html`

## 3. studio-server：日志与示例配置

- [x] 3.1 为代理/上游调试日志增加 `Authorization` 脱敏辅助函数（如有向控制台打印 header 的路径）
- [x] 3.2 在仓库根或 `apps/studio-server` 添加 `.env.example`（`STUDIO_PORT`、`STUDIO_UPSTREAM_BASE_URL`、可选密钥占位），并确认 `.gitignore` 已忽略 `.env`

## 4. studio-web：失败总览与预览回滚

- [x] 4.1 在显示器抽屉增加「最近失败」列表（启动时拉取 `/api/studio/failures`，WS 收到 `job.failed` 时追加/刷新）
- [x] 4.2 每条失败支持复制 `correlationId`/`jobId`
- [x] 4.3 在预览历史按钮旁增加「恢复为当前版本」：调用 `/api/preview/restore` 后刷新 iframe 与历史列表（需 `confirm`）

## 5. 收尾

- [x] 5.1 本 change 的 `tasks.md` 勾选完成项；必要时将 `openspec/specs/` 下主 spec 通过归档流程合并（留待 archive 阶段）
