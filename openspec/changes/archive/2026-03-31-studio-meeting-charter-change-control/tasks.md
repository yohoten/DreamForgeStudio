## 1. Charter（章程数据模型 + API）

- [x] 1.1 服务端：新增章程存储（按 projectId，草稿 + 最新归档 + 历史版本）
- [x] 1.2 服务端：新增 `GET/POST /api/charter`（读取/保存草稿，返回最新归档版本）
- [x] 1.3 服务端：新增 `POST /api/charter/archive`（归档新版本：version+1，写 archivedAt）
- [x] 1.4 服务端：新增 `GET /api/charter/history`（读取历史版本，最小实现）

## 2. Change Control（偏离检测 + 变更会）

- [x] 2.1 服务端：实现偏离检测（goal/milestones/nodes 对比最新归档版）
- [x] 2.2 服务端：新增变更记录存储（按 projectId，类型 goal/milestones/nodes changed，含 ts 与计数）
- [x] 2.3 服务端：新增 `GET/POST /api/charter/changes`（读取待确认变更、确认/清空）
- [x] 2.4 服务端：偏离提醒节流（同 projectId 30s 合并）
- [x] 2.5 Web：秘书/通知区展示“章程偏离”提示，并提供一键打开会议室入口

## 3. Meeting Room（会议室入口 + 立项/变更会 UI）

- [x] 3.1 Web：在策划区下方空地放置“会议室”物件并可点击
- [x] 3.2 Web：会议室弹窗（立项）：老板输入主题，展示三总监建议区与拍板按钮（规则模式先行）
- [x] 3.3 Web：会议室弹窗（章程编辑）：目标/里程碑/节点编辑与保存草稿
- [x] 3.4 Web：会议室弹窗（变更会）：展示待确认变更摘要、支持归档新版本与清空变更
- [x] 3.5 事件：新增/补齐 `meeting.*`、`charter.*`、`change.*`（最小字段：projectId、version、kind、summary）

## 4. Model Routing（会议强模型 / 执行小模型）

- [x] 4.1 服务端：新增模型路由配置存储（executionProviderId/meetingProviderId + 三档模式）
- [x] 4.2 服务端：队列入队支持路由用途标记（meeting/execution），据此默认选择 providerId
- [x] 4.3 Web：策略/设置新增“省钱/均衡/高质量”三档，配置会议/执行 provider
- [x] 4.4 Web：角色默认（制作人/技术/创意跟随会议）与个体覆盖入口（高级）

