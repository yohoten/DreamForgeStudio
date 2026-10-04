# vendor

## claude-game-studios

- **来源**：[Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios)
- **方式**：`git clone --depth 1` 快照；根目录 **未** 使用 `git submodule`（父仓库当前可非 git）。
- **用途**：对照上游版本与许可（MIT）；本项目实际使用的已定稿副本在 **仓库根 `.claude/`**，其中有裁剪与增补，不必与 `vendor/` 目录逐文件一致。

更新上游快照示例：

```bash
cd vendor/claude-game-studios
git fetch --depth 1 origin main
git reset --hard origin/main
```

合并时注意对比根目录 `STUDIO.md` 与 `.claude/agents/` 的差异。
