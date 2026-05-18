# Changelog

All notable changes to this project will be documented in this file.

> 说明：`0.0.12` 没有单独发布到 VS Code Marketplace，因此本次 `0.1.0` 的升级日志以 **已发布的 `0.0.11`** 为基线编写，并合并了原本准备进入 `0.0.12` 的内容。

## [0.1.5] - 2026-05-14

### Added

- 新增「合并到主分支」功能：
  - 支持将 worktree 分支一键合并到目标分支（trunk / master 等）
  - 入口：工作树视图右键菜单、行内按钮、命令面板
  - 目标分支以列表方式选择，当前分支标注项目数
  - 在每个项目主仓库中依次执行 `git checkout <目标>` → `git merge <源>`
  - 冲突项目单独汇总提醒
  - 日志输出面板打印完整 merge 命令和路径
- 新建 worktree 时自动复制 `.mgitsvn.json` 配置，`rootDir` 指向 worktree 实际路径

### Fixed

- 修复 worktree 中仓库始终显示「仅 git」标签的问题：适配 worktree 中 `.git` 为文件的目录结构，通过解析 `gitdir` 和 `commondir` 定位 SVN 元数据
- 修复删除 worktree 后同步文件残留，目录无法完全清理的问题

### Changed

- 将扩展版本提升到 `0.1.5`

## [0.1.0] - 2026-05-11

### Added

- 新增 SVN `https` 认证支持：
  - 支持通过 VS Code `SecretStorage` 保存凭据
  - 支持认证预热
  - 支持后台失败时自动回退到集成终端
- 新增 `svn:externals` 支持：
  - 扫描全部 externals
  - 扫描单个项目 externals
  - 区分目录 external 与 file external
- 新增目录 external 管理能力：
  - 可将目录 external 导入为受管项目
  - 自动写入父仓库 `.git/info/exclude`
- 新增 file external 管理能力：
  - 支持 `symlink` / `copy`
  - 支持规则持久化
  - 支持手动重放
  - 支持 worktree 中自动重放
- 新增 externals 自动策略：
  - `directoryMode: prompt | auto-manage | ignore`
  - `fileMode: prompt | auto-link | ignore`
- 新增命令：
  - `管理 SVN 凭据`
  - `清除 SVN 凭据`
  - `扫描 SVN Externals`
  - `扫描项目 Externals`
  - `导入项目 Externals`
  - `应用项目 File Externals`
  - `重放 File Externals`
  - `查看文档`

### Changed

- 将扩展版本提升到 `0.1.0`
- 完整更新 README，使其覆盖认证、externals、worktree 和自动纳管等完整功能
- 优化项目树、工作树和状态栏的显示
- 优化成功提示、确认对话框和欢迎消息体验
- 优化工具提示与图标显示

### Fixed

- 修复欢迎页“查看文档”依赖配置初始化的问题，现在未初始化时也可以直接查看 README
- 修复未初始化配置时仍可进入“创建工作树”流程的问题
- 修复 clone 后 externals 只会提示不会处理的问题，接入自动纳管策略后可以按配置自动处理

## [0.0.11] - 2026-01-12

### Notes

- 这是当前 VS Code Marketplace 上一版已发布版本。
- `0.1.0` 的升级说明均基于该版本展开。
