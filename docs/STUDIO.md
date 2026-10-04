# aiGameGongfang Studio — 多端小游戏与大模型工作流

本仓库以 **HTML5 页游** 与 **微信 / 抖音小游戏** 为主交付面，AI 助手通过 **OpenAI 兼容 HTTP API** 连接本地或自建推理端点（Ollama、vLLM、LM Studio 等）。角色定义与技能集来自上游 [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) 的快照（见 `vendor/claude-game-studios/`），已裁剪通用引擎 Agent，并增补平台专家。

## 技术栈（请在 `setup-web` 流程中写死具体选择）

- **Web 页游**：TypeScript；渲染/游戏框架在 README 或 `.claude/docs/technical-preferences.md` 中选定并版本锁定（Phaser / Cocos Web / 轻量 Canvas 等）。
- **微信小游戏**：官方开发者工具 + 文档一致的小游戏 API；仅使用仓库内 typings 或你贴出的官方片段，**禁止臆造 `wx` 方法签名**。
- **抖音小游戏**：同上，**禁止臆造 `tt` API**。
- **共享逻辑**：`packages/shared/`（或 `src/shared/`）；平台代码不得从 `src/web/` 直接引用微信/抖音全局对象。
- **版本控制**：Git；主叙事仍以设计文档与用户审批为准（见协作协议）。

## 本地大模型（OpenAI 兼容）

- **端点**：例如 Ollama `http://127.0.0.1:11434/v1`，模型名与 `baseURL` 以你的部署为准。
- **约束**：长任务拆分；先列将修改的文件再写入；平台 API 须有官方文档或项目内类型依据。
- **命令映射**：Claude Code 的 `/slash` 在本仓库中视为 **Skill 名称**；在 Cursor 或其它壳中通过引用 `.claude/skills/<name>/SKILL.md` 或「技能清单」触发同等流程。详见 `.claude/skills/local-llm/SKILL.md` 与 `.claude/skills/start-local/SKILL.md`。

## 项目结构

@.claude/docs/directory-structure.md

## 技术偏好与目录细节

@.claude/docs/technical-preferences.md

## 协作规则

@.claude/docs/coordination-rules.md

协作总览（若与上游文档冲突，以本仓库交付目标为准）：

@docs/COLLABORATIVE-DESIGN-PRINCIPLE.md

> **首次使用**：在自带 Slash 的环境可运行 `/start`；本地 OpenAI 兼容流程见 `/start-local`（技能：`start-local`）。

## 编码标准

@.claude/docs/coding-standards.md

## 上下文管理

@.claude/docs/context-management.md
