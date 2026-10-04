## Context

- 目标是在本仓库落地「游戏工作室」式 AI 辅助开发，**模型在本地或自建端点**（Ollama、vLLM、LM Studio 等），编辑器以 **Cursor** 为主；玩法与工程侧聚焦 **HTML 页游** 与 **微信 / 抖音小游戏** 三条交付通道。
- 上游 [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) 提供 Agent/Skill/Rule/Hook 的组织方式；本变更将其 **去品牌商化**，并与 **中国小游戏生态** 的目录、API 与发布流程对齐。
- 约束：官方小游戏政策与 SDK 以平台文档为准；本设计只定义 **仓库内契约**（目录、角色、规则文本、钩子边界）。

## Goals / Non-Goals

**Goals:**

- 单一仓库内可辨别的 **Web / 微信 / 抖音** 代码与资源边界，以及对应的 **路径级 Rules**。
- **Agent + Skills** 覆盖：平台初始化说明、多端差异、性能与包体、审核前自检清单（文档化 + 可选自动化）。
- **本地 LLM** 下的工作方式：任务拆分长度、何时用子代理、禁止「虚构 API」的约束写在总配置里。
- Hooks 在 **Windows** 上可执行（Git Bash 或 `npm run check:*` 包装）。

**Non-Goals:**

- 不实现具体游戏玩法或完整商用项目骨架（仅规范与模板级交付）。
- 不替代微信/字节 **开发者工具** 的安装与账号体系。
- 不要求单机模型能力与云端旗舰模型等价（以流程与规范补偿）。

## Decisions

1. **目录拓扑**  
   - 采用 `src/web/`（页游）、`src/platforms/wechat/`、`src/platforms/douyin/`（或与 `minigame-wechat` / `minigame-douyin` 并列），`packages/shared/` 放纯逻辑与无平台 API 的资源描述；**平台 API 不得从 Web 目录直接引用**（通过 adapter 或构建时注入）。  
   - *备选：* 单 `src/` + 大量 `#ifdef` 式条件编译 — 拒绝，不利于 Rule 路径匹配与审阅。

2. **与上游关系**  
   - **首次**：手动拷贝或子树合并 `.claude`（或 `.cursor` 下等价的 rules/agents）再 **替换** 引擎相关 Agent。  
   - *备选：* 长期 git subtree 跟踪上游 — 可作为后续优化，首版以「快照 + 文档说明差异」为主。

3. **本地模型**  
   - 总入口文档（如 `STUDIO.md`）写明：**单次对话任务上限**、**必须先列文件再改**、**禁止编造 wx/tt 对象方法**（须对照官方文档链接或仓库内 typings）。  
   - *备选：* 强绑定某一本地工具 — 不绑定，保持端点无关。

4. **引擎/框架**  
   - 页游默认 **TypeScript + 自研轻量或 Phaser/Cocos Web 之一**（在 `web-h5-game` spec 中锁「必须可选一种并在 README 声明」）；小游戏侧与 **微信/字节官方推荐的游戏引擎导出流程** 对齐，不在设计阶段强制唯一引擎品牌。  
   - *备选：* 只支持裸 Canvas — 可维护性差，列为非默认。

5. **Hooks**  
   - 首版 **JSON/资源命名** 校验 + **设计文档章节存在性**（若有 `design/gdd`）；小游戏包体大小 **警告级** 非硬失败。  
   - *备选：* 全套 bash 仅 Linux — 拒绝，需 Windows 可用。

## Risks / Trade-offs

- [Risk] 本地模型 **幻觉 API** → Mitigation：Rules 要求引用官方文档路径或项目内 `types/`；Code review Skill 强制 diff 里出现未定义符号则回退。  
- [Risk] 三端 **重复逻辑** 膨胀 → Mitigation：`shared` 层与 ADR 记录跨端变更；Producer Agent 负责协调。  
- [Risk] 上游模板 **大面积更新** → Mitigation：`UPGRADING.md` 增量维护；Breaking 在 proposal 已标注。  
- [Trade-off] 规范变重 → **小团队** 可删减 Agent 文件；保留「最小子集」在 `tasks.md` 中列出。

## Migration Plan

1. 在本仓库创建 `STUDIO.md`（或改写克隆来的 `CLAUDE.md`）与目录空壳。  
2. 按 `specs` 导入 Rules/Agents/Skills 的占位与首版正文。  
3. 跑通一条 **Web** 与一条 **小游戏** 的「零玩法」空项目导入开发者工具（验证路径与文档）。回滚：删除新增 `.claude` 片段并 git restore 目录。

## Open Questions

- 选用 **Cocos / Laya / Egret / 纯 TS** 中的哪一个作为默认教程路径（影响默认 Agent 话术与示例链接）。  
- 是否在仓库内引入 **子模块** 指向上游模板，还是仅 **文档链接 + 手拷**（由维护成本决定）。
