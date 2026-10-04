## ADDED Requirements

### Requirement: 按 projectId 预览产物
服务端 SHALL 支持按 projectId 提供预览入口，以在 UI 显示项目的当前产出。

#### Scenario: 打开项目预览
- **WHEN** UI 请求 `GET /preview?projectId=<id>`
- **THEN** 服务端 SHALL 返回该项目的预览内容（例如 index.html）

### Requirement: 保存项目预览内容
服务端 SHALL 提供保存预览内容的 API，并支持按 projectId 存储隔离。

#### Scenario: 保存 HTML 预览
- **WHEN** UI 调用 `POST /api/preview/save` 并提供 `projectId` 与 `html`
- **THEN** 服务端 SHALL 保存该内容并使后续 `GET /preview?projectId=<id>` 可访问

### Requirement: 预览安全边界（最小）
系统 SHALL 以最小安全边界提供预览：限制为本地保存内容，允许后续增加 CSP/sandbox。

#### Scenario: 预览隔离
- **WHEN** UI 在 iframe 中加载预览
- **THEN** 预览 SHOULD 使用 iframe 隔离（可使用 sandbox 属性作为后续增强）

