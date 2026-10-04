# Studio Web UI + OpenAI 兼容代理接入（方案 B）

本仓库提供一个本地可运行的「开罗风工作室」Web UI，它通过 **WebSocket** 实时订阅事件；事件来源包括：

- **仓库文件变更**（chokidar 监听）
- **OpenAI 兼容 `/v1/*` 转发代理**（记录 SSE chunk / tool_calls）

## 1) 安装依赖

在仓库根目录：

```bash
npm install
```

## 2) 启动服务端 + Web UI

在仓库根目录：

```bash
npm run dev
```

默认端口：

- **studio-server**：`http://127.0.0.1:8787`
  - WS：`ws://127.0.0.1:8787/ws`
  - agents：`http://127.0.0.1:8787/api/agents`
- **studio-web**：`http://127.0.0.1:5173/`

## 3) 让 Cursor 走代理（把 LLM 流变成可见事件）

### 3.1 设置上游推理端点

`studio-server` 默认把请求转发到：

- `STUDIO_UPSTREAM_BASE_URL`（默认 `http://127.0.0.1:11434/v1`，适配 Ollama）

如果你的上游是 vLLM / LM Studio，请把它改成对应的 `.../v1`。

### 3.2 Cursor 的 OpenAI 兼容 baseURL 指向本代理

把 Cursor（或任何 OpenAI-compatible 客户端）的 `baseURL` 改为：

- `http://127.0.0.1:8787/v1`

这样所有 `chat.completions` 的 **SSE 流式**响应都会被服务端记录成：

- `llm.chunk`
- `llm.message_done`
- （若 delta 中出现 tool_calls）`tool.start` / `tool.end`

#### 可选：给请求打上 Agent 与任务名

代理支持两个可选 Header（用于 UI 归因到工位）：

- `x-studio-agent`: `producer` / `web-h5-specialist` / ...（匹配 `.claude/agents/*.md` 里的 `name`）
- `x-studio-task`: 任务一句话摘要（例如 `实现 Web 工位 UI`）

> Cursor 的 UI 里不一定能自定义 header。若无法注入 header，UI 仍能显示全局事件，但可能归属到 `unknown`。

## 4) 隐私与日志轮转

默认事件日志写在仓库根：

- `studio_events.jsonl`

该文件已加入 `.gitignore`。若你要轮转/限制大小，可以：

- 定期删除该文件（服务会自动重新创建）
- 或后续把 JSONL 换成 SQLite（同一 event envelope 可复用）

