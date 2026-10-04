# studio-web-ui Specification

## Purpose
TBD - created by archiving change kairo-studio-web-ui-telemetry. Update Purpose after archive.
## Requirements
### Requirement: 工位视图展示 Agent
Web UI SHALL 展示工作室地图，并将每个 Agent 显示为一个工位（含名称、状态图标与气泡信息）。

#### Scenario: 打开页面看到工位
- **WHEN** 用户打开 Studio Web UI
- **THEN** UI SHALL 加载 Agent 列表并渲染对应工位

### Requirement: 相机交互
Web UI SHALL 支持拖拽平移、滚轮缩放，以及小地图点击跳转，避免工位过多时拥挤不可用。

#### Scenario: 缩放与平移
- **WHEN** 用户按住鼠标拖拽
- **THEN** 相机 SHALL 平移
- **WHEN** 用户滚动鼠标滚轮
- **THEN** 相机 SHALL 缩放

#### Scenario: 小地图跳转
- **WHEN** 用户在小地图区域点击
- **THEN** 主相机 SHALL 跳转到对应位置

### Requirement: 分区展示
UI SHALL 将 Agent 按部门/职责分区展示（例如制作、策划、程序、美术、QA/发布等），并保持可读性。

#### Scenario: 部门分区可见
- **WHEN** UI 渲染办公室
- **THEN** 用户 SHALL 能在地图上看到多个功能分区与分区标题

### Requirement: 房间系统（基础）
UI SHALL 展示若干功能房间（会议室、咖啡室等），并支持“选中 Agent → 点击房间 → 派遣进入房间”的交互；房间可处于锁定/开放状态。

#### Scenario: 派遣进入房间
- **WHEN** 用户选中一个 Agent 并点击一个已开放房间
- **THEN** UI SHALL 触发一次 `room.enter` 事件（通过服务端事件注入或等价机制）
- **AND THEN** UI SHALL 以动画/状态变化展示该 Agent 已进入房间

### Requirement: 招聘/派单面板（基础）
UI SHALL 提供招聘/派单入口：设置 ComputeSlots、勾选雇佣名单、选择 Agent 并提交任务入队、观察队列与运行中数量。

#### Scenario: 入队并驱动忙碌状态
- **WHEN** 用户在面板中提交一条任务入队
- **THEN** 系统 SHALL 产生 `job.enqueued` 事件
- **AND THEN** 当任务开始执行时，UI SHALL 看到对应 Agent 进入“工作中”状态

### Requirement: 技术科普可视化（金币/电费）
UI SHALL 用像素沙盘内的可视化反馈，解释“本地模型 vs 外部 API”的成本与体验差异。

#### Scenario: 外部 API 扣费可见
- **GIVEN** 当前任务的 provider 为外部 API（例如 `providerId=cloud`）
- **WHEN** 任务开始或产生输出（`job.started` / `llm.chunk`）
- **THEN** UI SHOULD 在对应 Agent 附近展示“金币扣费”特效（例如飘字 `-¥x` / `-金币x`）
- **AND THEN** UI SHOULD 同步更新财务面板的数字（允许为估算值）

#### Scenario: 本地模型电费/显存提示
- **GIVEN** 当前任务的 provider 为本地（例如 `providerId=local`）
- **WHEN** 任务开始或产生输出
- **THEN** UI SHOULD 展示“电费/显存”类图标提示（允许不显示具体金额）

### Requirement: 秘书播报（中文）
UI SHALL 以中文“秘书”通知解释本轮消耗与建议，降低新手理解成本。

#### Scenario: 任务完成播报
- **WHEN** UI 观察到某任务完成（`job.finished` 或等价信号）
- **THEN** UI SHOULD 追加一条中文播报（例如：本轮 tokens/费用估算、本月累计、是否建议切换 provider/ComputeSlots）

### Requirement: 算力等级（S/A/B/C）
UI SHALL 展示一个粗粒度算力等级，用于解释“能养活多少本地 Agent/并发槽位”的上限。

#### Scenario: 体检后显示等级
- **WHEN** 用户执行体检（粗测/阶梯）或 UI 获取到设备 profile
- **THEN** UI SHOULD 显示算力等级（S/A/B/C）与简短中文解释（例如推荐模型档位、推荐 ComputeSlots）

### Requirement: 自动外包开关（可选）
UI SHALL 提供“自动外包/自动切换 provider”的开关与解释文案，避免用户在低配机器上卡死。

#### Scenario: 开启自动外包
- **GIVEN** 用户开启自动外包
- **WHEN** 本地 provider 不可用或延迟过高或队列积压明显
- **THEN** 新入队任务 SHOULD 自动选择外部 API provider
- **AND THEN** UI SHOULD 明确提示“为何切换 + 预估成本影响”

### Requirement: 叠层控件点击不穿透到画布
当 HTML 控件叠在 Phaser 画布之上时，用户 SHALL 能在该控件可见区域内完成点击或拖拽，而不误触发下层画布平移或缩放，除非该区域明确设计为透明穿透。

#### Scenario: 左侧顶栏状态区
- **WHEN** 用户点击 HUD 顶部标题行或状态药丸所在区域
- **THEN** 浏览器 SHALL 命中该 UI 层，而不应触发画布拖拽起始（在常规桌面浏览器下）

#### Scenario: 抽屉打开时
- **WHEN** 用户点击抽屉遮罩或抽屉面板内容
- **THEN** 事件 SHALL 由遮罩或面板处理，而不应穿透到画布交互

#### Scenario: 拖拽画布后不误点选
- **WHEN** 用户拖拽平移画布并在工位或房间热点上松开指针，且移动距离超过约 12 像素
- **THEN** 系统 SHALL NOT 将该次操作视为对工位或房间的「点击选中」

