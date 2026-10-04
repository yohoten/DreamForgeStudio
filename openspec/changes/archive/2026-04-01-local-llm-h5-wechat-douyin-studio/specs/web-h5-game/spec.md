## ADDED Requirements

### Requirement: Web 目录边界

面向浏览器的游戏代码 SHALL 位于约定的 `src/web/`（或设计文档中声明的等价路径），且 MUST 不直接依赖微信或抖音专有的全局运行时对象。

#### Scenario: 页游构建

- **WHEN** 执行页游本地开发或构建
- **THEN** 入口与资源路径 MUST 自洽于 Web 目录或 Web 构建配置，不强制安装小游戏开发者工具

### Requirement: 性能与资源约定

Web 规范 SHALL 要求主循环使用稳定的时间步或明确文档化的帧计时方式；资源加载失败 MUST 有可观测处理（日志或 UI 提示）而非静默崩溃。

#### Scenario: 主循环审查

- **WHEN** 对 `src/web/**` 中游戏主循环相关文件做变更评审
- **THEN** 评审清单 MUST 包含「帧时间与依赖全局对象是否合规」

### Requirement: 技术栈声明

仓库 README 或 `design/` 内 SHALL 声明页游所选主技术栈（如 Phaser、Cocos Web、或裸 Canvas + TS）的一种，并维持与 Rules 一致。

#### Scenario: 新贡献者对齐栈

- **WHEN** 新贡献者阅读 README
- **THEN** 其 MUST 能识别当前默认 Web 技术栈名称及最低浏览器目标（若适用）
