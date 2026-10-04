## ADDED Requirements

### Requirement: Agent 角色覆盖

工作室 Agent 集合 SHALL 至少覆盖：产品/愿景协调、Web 前端与页游、微信小游戏、抖音小游戏、质量与自检清单（可为合并角色，但 MUST 在 roster 表中可查）。

#### Scenario: 查阅角色表

- **WHEN** 维护者打开 Agent 总览（如 `docs/agent-roster.md` 或等价文件）
- **THEN** 其 MUST 能找到上述领域的职责说明与升级路径

### Requirement: Skills 与平台工作流

Skills（或 Cursor 命令）SHALL 包含：项目入门、Web 初始化、微信小游戏初始化、抖音小游戏初始化、多端差异对照、发版前检查中的至少各一条入口。

#### Scenario: 新平台接入

- **WHEN** 团队新增一条交付渠道（例如仅 Web 转微信）
- **THEN** 存在对应 Skill 或文档步骤，可指导从共享逻辑到平台目录的迁移检查

### Requirement: Hooks 可执行性

自动化 Hooks SHALL 在 Windows 10+ 上可执行（通过 Git Bash、PowerShell 包装或 npm script），且在可选依赖缺失时 MUST 降级为已记录的空操作或警告，不阻断核心开发流程。

#### Scenario: 无 jq 环境

- **WHEN** 开发者未安装可选校验工具
- **THEN** Hook MUST 不以此为由使 git 提交完全失败，除非项目文档明确声明该工具为必需

### Requirement: 路径级 Rules

路径级 Rules SHALL 绑定 `src/web/**`、`src/platforms/wechat/**`、`src/platforms/douyin/**`（或 design 中最终路径），且内容 MUST 与各 capability spec 一致、无互相矛盾的平台 API 约束。

#### Scenario: 编辑Gameplay文件

- **WHEN** AI 或人类在对应路径编辑文件
- **THEN** 生效的 Rule MUST 仅强化该路径所属平台或 Web 的约束，不混入另一平台专有全局对象
