## Context

Studio 已有 JSONL 事件总线、WebSocket 分发、`production/preview/<projectId>/index.html` 单文件预览，以及 OpenAI-compatible 代理。迭代痛点是：失败信息分散、预览覆盖后难回溯、密钥与端点易误提交。

## Goals / Non-Goals

**Goals:**

- 在 Web UI 提供「最近失败」总览（可关联 correlationId / job 标识），降低排障成本。
- 为预览 HTML 建立可列举的历史版本（按生成时间或单调版本号），支持选择与回滚（恢复为某版内容）。
- 文档与代码路径统一：敏感配置来自环境变量或本地未跟踪文件；日志与事件 payload 不包含完整 API Key。

**Non-Goals:**

- 不做分布式追踪（OpenTelemetry 全链路）；本阶段以事件 + 轻量 API 为主。
- 不做云端对象存储；历史文件仍落在仓库 `production/preview/` 下（或约定子目录），体积由团队策略约束。

## Decisions

1. **失败诊断数据源**
   - 优先从现有 `studio_events.jsonl` 与队列/job 相关事件中抽取 `type` 含失败语义的事件（如 `job.failed`、`error`、`proxy.*` 失败）；若当前无统一类型，则新增规范化事件 `job.failed`（payload：`jobId`、`stage`、`message`、`hint`、`correlationId`）。
   - UI 通过 tail/已有订阅聚合「最近 N 条失败」，必要时增加 `GET /api/studio/failures?limit=` 只读汇总（实现任选其一，以不重复造轮子为准）。

2. **预览版本存储布局**
   - 在 `production/preview/<projectId>/` 下增加 `versions/`（或 `history/`）子目录：每次成功生成写入 `index-<isoOrSeq>.html`（或复制当前 `index.html` 为带时间戳文件名），并维护一个小的 `manifest.json`（`{ "current": "...", "entries": [{ "id", "savedAt", "label" }] }`）供列表 API 返回。
   - 「回滚」= 将选定版本内容写回主 `index.html`（或 swap symlink，二选一；Windows 兼容优先 copy 覆盖）。

3. **密钥与配置**
   - 服务端：`STUDIO_UPSTREAM_BASE_URL`、可选 `OPENAI_API_KEY` 等仅 `process.env`；`.env` 入 `.gitignore`，提供 `.env.example` 无真实密钥。
   - 客户端：不打包密钥；任何「连接测试」仅通过同源服务端代理。
   - 日志：代理日志可记录请求元数据，但 MUST 对 `Authorization` 做脱敏（仅保留前缀或 `***`）。

4. **与现有 spec 的关系**
   - `studio-web-ui`：新增面板或抽屉展示失败列表与预览历史。
   - `studio-events-bus`：补充失败类事件的字段约定（ADDED）。

## Risks / Trade-offs

- [Risk] 历史文件增多导致仓库变大 → Mitigation：限制保留条数（如最近 20 版）或文档说明定期清理。
- [Risk] 回滚覆盖当前文件导致误操作 → Mitigation：回滚前写入 manifest 且 UI 二次确认。
- [Trade-off] 无数据库时汇总 API 需扫 JSONL → Mitigation：限制 limit、异步或缓存最近内存索引（可选）。

## Migration Plan

- 新增目录与 manifest 时对已有 `projectId` 首次访问时惰性创建 `versions/` 与空 manifest。
- 回滚：保留「上一版」备份文件名一次（可选）以便撤销。

## Open Questions

- 是否在服务端对 HTML 生成任务统一增加 `max_tokens` 上限（已有则仅文档化）？
- 预览历史是否在 UI 默认折叠以节省空间？
