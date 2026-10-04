## ADDED Requirements

### Requirement: 本地推理入口说明

仓库 SHALL 在根或 `docs/` 内提供单一入口文档，说明如何在本项目中使用本地大模型（含：推荐上下文长度策略、任务拆分原则、禁止编造平台 API 的约束）。

#### Scenario: 新人读取入口文档

- **WHEN** 维护者打开该入口文档
- **THEN** 文档中 MUST 说明本地端点配置在 IDE 侧完成，且与 upstream「仅 Claude Code」表述脱钩

### Requirement: 任务粒度与上下文

使用本地模型时，Agent/Skill 文本 SHALL 建议单次实现范围不超过「一个小功能点或单文件主体修改」，并在过长时拆分为多步。

#### Scenario: Skill 描述任务边界

- **WHEN** 任一 Skill 描述涉及实现类工作
- **THEN** Skill MUST 包含或可指向「如何拆分任务」的说明

### Requirement: API 真实性

针对微信、抖音等平台 API，生成或修改代码时 SHALL 以官方文档或仓库内已有类型定义为依据；若无依据，MUST 以 TODO 或 Issue 标出而非写入虚构方法名。

#### Scenario: 缺少类型定义时

- **WHEN** 代码路径位于 `src/platforms/wechat` 或 `src/platforms/douyin`（或提案 design 中确定的等价路径）
- **THEN** 新增平台调用 MUST 可被追溯到文档链接、SDK 样本或库内类型，否则 MUST 留空实现与标记
