# studio-spritesheet-pack（变更增量）

## ADDED Requirements

### Requirement: 自动拼接 spritesheet
系统 SHALL 提供将同一 `runId` 目录下（或显式列出的）多帧 PNG 自动拼接为单张横向或网格排列的 `sheet.png`，并写出 `manifest.json`，描述帧宽、帧高、帧数与在 sheet 中的位置（或统一网格参数）。

#### Scenario: 多帧等尺寸
- **WHEN** 目录内存在 N 张尺寸一致的 PNG
- **THEN** 系统 SHALL 生成 `sheet.png` 与 `manifest.json`
- **AND THEN** manifest SHALL 可被游戏脚本以相对路径加载（无人工编辑）

### Requirement: 全流程无人工导出
拼接过程 SHALL 仅由服务端脚本完成；不得依赖外部图形软件手动操作。

#### Scenario: 无人参与
- **WHEN** 拼接任务完成
- **THEN** 仓库中 SHALL 仅出现程序写入的文件
