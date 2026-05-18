# 贡献指南

感谢你对 MGitSVN 的关注！欢迎参与贡献。

## 如何贡献

### 报告问题

1. 在 [GitHub Issues](../../issues) 中搜索是否已有相同问题
2. 如果没有，创建新 Issue，包含以下信息：
   - 操作系统和 VS Code 版本
   - MGitSVN 版本
   - 复现步骤
   - 期望行为与实际行为
   - 输出面板（`MGitSVN` channel）中的相关日志

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 安装依赖并编译：
   ```bash
   pnpm install
   pnpm run compile
   ```
4. 开发时使用 watch 模式，按 `F5` 启动扩展开发宿主：
   ```bash
   pnpm run esbuild-watch
   ```
5. 提交前确保编译通过：
   ```bash
   pnpm run compile
   ```
6. 提交代码并推送到你的 Fork
7. 创建 Pull Request

### 开发提示

- 项目使用 TypeScript + esbuild 构建
- 测试文件位于 `src/test/unit/`
- 运行测试：`npm test`
- 打包 vsix：`make package`

### 代码风格

- 使用 TypeScript 严格模式
- 关键逻辑用中文注释，命名用英文
- 遵循项目现有代码风格

### Commit 规范

使用以下格式：

```
<类型>: <简短描述>
```

类型包括：`feat`、`fix`、`refactor`、`docs`、`test`、`chore`

## 发布流程（维护者）

```bash
make publish-current        # 发布当前版本
make publish-bump           # 升 patch 版本后发布
make publish-bump VERSION=minor  # 升 minor 版本后发布
```

## License

贡献的代码将按照 [MIT License](LICENSE) 发布。
