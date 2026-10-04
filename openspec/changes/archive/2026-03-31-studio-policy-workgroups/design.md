## Context

当前 Studio 已具备以下基础：

- 事件总线（JSONL + WS）与 UI 状态推导
- 招聘/雇佣/队列/ComputeSlots + provider 绑定（local/cloud 等）
- 沙盘等距场景与“部门显示器/项目显示器”交互雏形
- 本地/互联网模型配置、连通测试、Ollama 检测与启动
- 预览输出（HTML）保存与 `/preview` 展示

但当前的自动化仍偏“手动点按钮派单”，缺少：

- 可配置的“管理策略”让部门自行运转（模拟经营的策略性来源）
- 多项目并行的游戏化约束（算力=可同时开的工作组数量）
- 更清晰的“验收/驳回/重做”工单闭环与归因（project/workgroup）

## Goals / Non-Goals

**Goals:**

- 引入可持久化的 **Policy（管理策略）**：覆盖制作人/技术总监/创意总监三条线，并能影响派单、provider 选择、重试与验收门禁。
- 引入 **Workgroups/Projects（工作组/项目）**：把“并行能力”从仅 ComputeSlots 扩展为“可同时推进的项目数”，并让 job 归因到 project/workgroup。
- 将“部门显示器”升级为 **验收工单**：可查看部门产出/问题/卡点，并在“通过/驳回/重做”时按策略生成派单任务（规则模式默认）。
- 将“预览显示器”升级为 **按 projectId 的预览沙盒**：每个项目维护独立的预览 HTML（或最小的文件集），UI 可切换查看。
- 全链路中文 UI/文案优先；大模型增强为可选项，不作为核心依赖。

**Non-Goals:**

- 不实现完整 CI/CD、真实自动测试框架与真实 bug 统计（先用事件与启发式指标）。
- 不实现真实多人权限/组织体系（先单机或局域网）。
- 不实现真实第三方平台（豆包/音乐等）的正式 SDK 接入（先做 provider 占位与可配置）。

## Decisions

1. **Policy 采用“规则引擎优先 + 可选 LLM 增强”**
   - 规则引擎：确定性、可解释、成本低，适合作为默认。
   - LLM 增强：只负责“表达与生成”（总结、拆单文本、验收标准），不直接拥有高权限；输出仍需落地为可执行的任务/策略决策。

2. **项目并行与 ComputeSlots 分离**
   - ComputeSlots：执行层并发（同一时刻跑多少 job）。
   - Workgroup/Project slots：产品层并行（同一时刻允许多少项目处于“进行中”）。
   - 这样用户能直观理解“我能同时做几个游戏”，并形成经营成长点。

3. **统一归因字段：job → workgroupId/projectId**
   - 入队时允许指定 projectId/workgroupId；若不指定则落到默认项目（project_1）。
   - 事件 payload 最小包含：`jobId`、`providerId`、`projectId`、`workgroupId`（尽量），用于 UI 聚合与部门看板统计。

4. **预览沙盒按 projectId 存储**
   - 服务端以 `production/preview/<projectId>/index.html` 存储产出。
   - `/preview?projectId=...` 直接返回该项目的 index.html。
   - 未来扩展：允许多文件（assets、js/css）与构建，但不影响该路径约定。

5. **验收工单（部门显示器）输出“可解释指标 + 动作”**
   - 指标先基于事件与 fs.change 聚合（变更文件、输出片段、失败/错误、阻塞人数）。
   - 动作（通过/驳回/重做）生成新的 job 入队请求，并携带 project/workgroup 归因。

## Risks / Trade-offs

- [Risk] 规则策略过于简单导致“看起来很智能但不准” → Mitigation：所有决策可回放（记录 policy.decision），并提供用户可调整的阈值与开关。
- [Risk] 多项目并行导致状态复杂（job/事件归因不清） → Mitigation：强制 projectId/workgroupId 最小字段；默认项目兜底；UI 聚合只按显式归因计算。
- [Risk] 预览 HTML 有安全风险（XSS/跨域） → Mitigation：预览只加载本地保存内容；后续可加 CSP、禁用某些 API、沙盒 iframe（`sandbox` 属性）。
- [Risk] 模型供应商差异导致模型列表/接口不一致 → Mitigation：只依赖 OpenAI 兼容最小子集；对不兼容 provider 标记“不可派单/仅建议接入”。

