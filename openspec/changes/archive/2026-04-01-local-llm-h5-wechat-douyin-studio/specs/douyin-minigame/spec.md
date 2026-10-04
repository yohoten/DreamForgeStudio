## ADDED Requirements

### Requirement: 抖音小游戏代码隔离

抖音（字节）小游戏相关代码 SHALL 位于 `src/platforms/douyin/`（或设计文档声明的等价路径），与微信目录 MUST 分离；共用逻辑 MUST 位于共享模块而非复制粘贴平台 API。

#### Scenario: 平台 API 引用

- **WHEN** 新增字节小游戏 API 调用
- **THEN** 调用 MUST 落在抖音平台目录或 adapter，且 MUST 可从官方文档或类型定义映射

### Requirement: 与微信差异文档

仓库 SHALL 维护简短对照说明（可在 `docs/`）：生命周期、存储、广告、登录等关键差异项，以便 Agent 与人类开发者不混淆两套 API。

#### Scenario: 跨端功能开发

- **WHEN** 同一功能需要同时覆盖微信与抖音
- **THEN** 开发者 MUST 能在对照文档中查到至少一类差异（如初始化入口或全局对象名）

### Requirement: 构建与审核清单

文档 SHALL 包含抖音小游戏发布前检查项（构建工具版本、域名、类目与内容合规指向官方说明）；代码变更影响分包或隐私接口时 MUST 更新对应检查项描述。

#### Scenario: 发版前

- **WHEN** 准备抖音侧提审或发版
- **THEN** 维护者 MUST 可按清单完成工具与合规项确认
