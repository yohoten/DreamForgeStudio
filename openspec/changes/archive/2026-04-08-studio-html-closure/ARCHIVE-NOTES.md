# 归档说明：Studio 闭环打通（HTML 可玩预览）

本归档用于记录一次“会议立项 → 衔接派单 → 程序产出单文件 HTML → 显示器预览/分享”的闭环打通与稳定性修复。

> 说明：当前仓库无活跃的 openspec change（`openspec list` 为空），因此此归档以 archive 目录形式保留“已落地实现”的关键变更点与定位结论，便于后续追溯。

## 已达成结果

- 程序任务可稳定产出**可直接运行**的单文件 HTML，并写入 `production/preview/<projectId>/index.html`
- 「显示器」可复制预览链接、在浏览器新标签打开试玩
- 工位上方可直接显示岗位状态与正在做的事（排队/执行/生成/异常）
- 立项衔接改为**严格串行**（策划→程序→美术→QA），避免乱序造成“看似卡住/QA 先结束”的错觉
- 增强可观测性：预览未落盘会发出明确原因（`preview_not_saved_from_job`）

## 关键定位结论

- DeepSeek `deepseek-chat` 上游对 `max_tokens` 有上限：`[1, 8192]`。此前程序任务设置过大导致 400，从而“任务结束但无 HTML 落盘”。

## 主要变更文件（按模块）

### studio-server

- `apps/studio-server/src/index.ts`
  - 程序类 HTML 任务默认非流式（可通过 env 强制流式）
  - 程序任务 `max_tokens` 钳制到 8192，适配 DeepSeek 上限
  - 预览落盘结果结构化返回；失败发 `preview_not_saved_from_job`
  - `/preview` 增加 CORS header，允许 Web 端从 5173 侧 fetch 预览内容
  - 立项衔接串行链（上一任务结束后才入队下一步）

### studio-web

- `apps/studio-web/src/main.ts`
  - 修复历史日志重放顺序（防止旧 chunk 覆盖新 finished）
  - 定期与 `/api/queue` 同步，防止工位永久“生成中”
  - 显示器新增预览链接输入框 + 复制/打开按钮
  - 工位新增头顶状态条（状态 + 摘要）
- `apps/studio-web/index.html`
  - 显示器 UI 增加链接区

### 预览占位

- `production/preview/project_1/index.html`
  - 默认改为占位说明页（避免与真实产出混淆）

## 回滚提示

- 若需要恢复旧逻辑：优先回滚 `apps/studio-server/src/index.ts` 中的
  - `max_tokens` 钳制
  - 程序/QA 默认非流式
  - producer chain 串行推进

