## Why

基于 [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) 的「多 Agent 游戏工作室」模式很强，但默认面向 Claude Code 与 Godot/Unity/Unreal；我们希望在 **本地大模型 + Cursor（或同类 IDE）** 下复用该结构，并 **统一支持 HTML 页游、微信小游戏、抖音小游戏** 的规范与分工，降低多端试错成本。

## What Changes

- 引入（或 fork 后改写）工作室根配置与说明：弱绑定云端闭源助手，强调 **本地推理端点、上下文长度与任务粒度**。
- 新增/替换 **Agent 名单与职责**：前端/H5、微信小游戏、抖音小游戏、构建与发布、适配与性能；移除或可选化与本栈无关的引擎 Agent。
- 新增 **Skills（工作流命令）**：引擎/平台初始化、分包与审核清单、多端差异对照等。
- 新增 **路径级 Rules**：`web/**`、`platforms/wechat/**`、`platforms/douyin/**`（或等价目录）下的 API 使用、资源与安全约束。
- 调整 **Hooks**：在 Windows 下可运行（Git Bash 或 npm scripts）；校验小游戏包体、JSON 配置等（在能力范围内渐进启用）。
- 文档与目录约定：**design/**、**src/**、多端构建产物与官方工具链说明。
- **BREAKING**：若从上游模板同步升级，凡改写 `CLAUDE.md`、`.claude/agents` 命名与 hierarchy 的合并均需人工对照（与上游语义不兼容）。

## Capabilities

### New Capabilities

- `local-llm-integration`: 本地大模型与 IDE 集成方式、提示词与任务拆分原则、与上游「Claude Code」表述的脱钩与替代入口文档。
- `web-h5-game`: HTML 页游技术栈约定（Canvas/WebGL、主流框架可选）、资源与性能、浏览器兼容与调试。
- `wechat-minigame`: 微信小游戏运行时能力、分包与域名、开放数据域、审核与常见卡点；与 H5 的代码组织边界。
- `douyin-minigame`: 抖音（字节）小游戏 API 与构建流程、与微信差异、发布与合规要点。
- `studio-agents-workflows`: 从上游继承的总监/主程/专项分工在本仓库中的映射；Skills 列表与 Hooks 清单的落地范围。

### Modified Capabilities

- （当前仓库 `openspec/specs/` 下无既有 capability，此项留空。）

## Impact

- 新仓库或本目录下新增/改写：`AGENTS.md` 或等价总览、`.cursor`/`openspec` 指引、（若采用）`.claude/` 下 agents/skills/rules/hooks 全文或子集。
- 依赖：可选上游模板 git 子模块或一次性拷贝；本地需 **OpenSpec CLI**（已用于本变更）、后续实现阶段需 **Node/Git** 及微信/字节 **开发者工具** 由开发者本机安装。
- 对现有多平台 **API 与审核策略** 依赖外部文档，本变更以「可执行的团队规范与目录契约」为主，不替代官方 SDK。
