# 造梦游戏工坊

[English](docs/README.en.md) | [日本語](docs/README.ja.md)

面向 **HTML5 页游** 的 AI Agent 工作室编排平台。等距办公室场景 + 企业沙盘模拟——将不同部门/角色的 AI Agent 串成可控流水线，通过 **OpenAI 兼容 HTTP API** 连接本地或云端推理端点。

## 快速开始

```bash
# 需要 Node.js >= 18
npm install
npm run dev
```

- 前端: http://127.0.0.1:5173
- 后端: http://127.0.0.1:8787
- 登录: http://127.0.0.1:5173/auth.html

## 核心功能

### 工作室编排
- **等距办公室场景** — 56×36 网格，7 部门 + 9 间公共设施，Agent A* 寻路漫游
- **多 Agent 协作** — ~40 个 AI Agent 角色，可雇佣/解雇/绑定模型
- **任务队列** — 优先级排序、并发槽位控制、HTML 输出自动验证重试
- **工作流引擎** — 3 套内置审批流模板（游戏开发/热修复/资产生产）+ 拖拽编排器

### 企业沙盘模拟
- **绩效看板** — 6 部门通过率/负载/综合分实时排名
- **任务流水线** — 策划→程序→美术→QA 四阶段可视化，瓶颈自动高亮
- **Sprint 周期** — 四阶段（分配→执行→验收→复盘）进度跟踪
- **OA 审批流** — 串行/并行工作流模板，支持手动审批节点
- **拖拽编排器** — 可视化构建自定义流水线，保存即执行

### 基础设施
- **SQLite 持久化** — 10 张表，JSON 自动迁移备份
- **模型路由** — 省钱/均衡/高质量三档，支持本地+云端混合
- **DeepSeek V4 Pro / Flash / R1** — 预设模型配置 + Moonshot + MiniMax
- **用户认证** — 注册/登录/SHA256 密码哈希/Bearer Token
- **实时通信** — WebSocket 事件流 + 自动重连

## API 端点

| 分类 | 端点 | 说明 |
|------|------|------|
| Auth | `/api/auth/register`, `/login`, `/me`, `/logout` | 用户认证 |
| Projects | `GET/POST/DELETE /api/projects` | 项目管理 |
| Queue | `GET /api/queue`, `POST /enqueue` | 任务队列 |
| Workflow | `/api/workflow/templates`, `/runs`, `/runs/approve` | 审批流 |
| Providers | `/api/providers`, `/config`, `/test` | 模型配置 |
| Finance | `/api/finance/summary`, `/reset` | 财务统计 |
| Assets | `/api/studio/assets/generate-image`, `/pack-spritesheet`, `/transcode-video` | 资产管线 |

## 模型支持

| 预设 | BaseURL | 模型名 |
|------|---------|--------|
| DeepSeek V4 Pro | `api.deepseek.com/v1` | `deepseek-v4-pro` |
| DeepSeek Flash | `api.deepseek.com/v1` | `deepseek-flash` |
| DeepSeek R1 | `api.deepseek.com/v1` | `deepseek-reasoner` |
| Moonshot | `api.moonshot.cn/v1` | `moonshot-v1-8k` |
| MiniMax | `api.minimaxi.com/v1` | `abab6.5s-chat` |
| 本地 Ollama | `127.0.0.1:11434/v1` | 可配置 |

## 外部资源（可选）

将以下文件放入 `apps/studio-web/public/assets/` 即可自动加载，缺失时回退程序化纹理：

```
assets/spritesheet_agents.png      — 角色精灵表（768×128）
assets/spritesheet_furniture.png   — 家具精灵表（640×64）
assets/portraits/*.png             — Agent 立绘（128×128, 6 张）
```

## 技术栈

- TypeScript + Vite + Phaser 3（前端）
- Node.js HTTP + WebSocket + tsx（后端）
- better-sqlite3（持久化）
- OpenAI 兼容 API 代理

## 优化方向

- **贴图 L2** — 外部 spritesheet 替换程序化像素纹理
- **经营沙盘** — Agent 技能分化/人才养成/士气系统
- **国际化** — i18n 中/英/日
- **端到端测试** — Vitest + Playwright
- **移动端适配** — 响应式布局
# DreamForgeStudio
