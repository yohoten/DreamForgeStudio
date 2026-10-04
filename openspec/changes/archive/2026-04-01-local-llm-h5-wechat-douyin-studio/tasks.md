## 1. 仓库骨架与入口文档

- [ ] 1.1 创建 `src/web/`、`src/platforms/wechat/`、`src/platforms/douyin/`（或 design 中最终路径）及 `packages/shared/`（或 `src/shared/`）空目录与占位 README
- [ ] 1.2 添加根或 `docs/` 下本地大模型入口文档（对应 `local-llm-integration`：任务拆分、禁止虚构 API、IDE 端点配置指引）
- [ ] 1.3 在 README 声明页游默认技术栈与最低浏览器目标（对应 `web-h5-game`）

## 2. 上游模板整合

- [ ] 2.1 克隆或解压 [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) 快照，列出与本栈冲突的文件（引擎类 Agent 等）
- [ ] 2.2 合并 `.claude`（或迁移到 `.cursor/rules` + 文档）中与 Hooks、权限兼容的部分，删除或归档 Godot/Unity/Unreal 专用 Agent
- [ ] 2.3 编写 `UPGRADING.md` 片段：与上游差异及手动手合点

## 3. Agent 与 Skills

- [ ] 3.1 新增或改写 Agent：Web 页游、微信小游戏、抖音小游戏、共享逻辑/Producer（对应 `studio-agents-workflows`）
- [ ] 3.2 维护 `docs/agent-roster.md`（或等价表）：角色、领域、升级路径
- [ ] 3.3 添加 Skills：`/start-local`、`/setup-web`、`/setup-wechat-minigame`、`/setup-douyin-minigame`、`/platform-diff`、`/release-checklist-minigame`

## 4. 路径级 Rules

- [ ] 4.1 为 `src/web/**` 添加 Rule：无 wx/tt 全局、主循环与时间步、资源错误可观测
- [ ] 4.2 为 `src/platforms/wechat/**` 添加 Rule：API 有据、包体/分包检查项、开放数据域与密钥
- [ ] 4.3 为 `src/platforms/douyin/**` 添加 Rule：与微信隔离、字节 API 有据、构建与合规清单
- [ ] 4.4 为 `packages/shared/**`（或 `src/shared/**`）添加 Rule：禁止直接引用平台全局，仅通过 adapter

## 5. 文档与对照

- [ ] 5.1 编写 `docs/platform-wechat-vs-douyin.md`：生命周期、存储、登录等差异要点（对应 `douyin-minigame` / `wechat-minigame`）
- [ ] 5.2 微信发版前清单与抖音发版前清单（独立小节或同文档分节，链到官方文档）

## 6. Hooks 与 Windows

- [ ] 6.1 实现或移植 JSON/资源命名校验；可选工具缺失时警告而非硬失败（对应 `studio-agents-workflows`）
- [ ] 6.2 提供 `package.json` 中 `npm run check:assets` / `check:json` 包装，确保 PowerShell 下可调用
- [ ] 6.3 在 `docs/setup-requirements.md` 记录 Git Bash、Node、可选 jq 与微信/字节开发者工具

## 7. 验证

- [ ] 7.1 Web：本地起 dev server，空场景可运行无控制台致命错误
- [ ] 7.2 微信：项目可导入微信开发者工具构建通过（零玩法占位即可）
- [ ] 7.3 抖音：项目可导入字节侧工具或通过文档所列命令构建（零玩法占位即可）
- [ ] 7.4 运行 `openspec status --change local-llm-h5-wechat-douyin-studio` 确认变更可归档/进入 apply 流程
