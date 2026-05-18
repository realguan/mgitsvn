# MGitSVN

面向 `SVN + git-svn + 多仓库` 开发场景的 VS Code / Windsurf 插件。

它解决的是这样一类项目痛点：

- 代码托管在 SVN，但日常开发习惯是 Git 工作流
- 一个业务往往拆成多个 SVN 子项目，需要批量同步、提交、切分支
- 需要同时维护多个分支或版本，频繁切换目录很痛苦
- 某些项目还包含 `svn:externals`，手工管理成本高

`MGitSVN` 的目标不是替代 Git 或 SVN，而是把**多仓库 git-svn 协作流程**收敛到一个统一的侧边栏里。

---

## 主要功能

### 1. 多仓库批量 git-svn 操作

- 批量 `git svn rebase`
- 批量 `git svn dcommit`
- 批量查看项目状态
- 批量克隆配置中的所有项目

适合微服务、组件化或多模块 SVN 项目。

### 2. 多仓库统一分支管理

- 跨多个仓库统一切换 / 创建 Git 本地分支
- 支持切换不同的 SVN remote
- 适合 trunk / branch 并行维护场景

### 3. Worktree 工作流

- 批量创建工作树（自动复制 `.mgitsvn.json` 配置）
- 批量删除工作树
- 直接打开整个 worktree 工作区
- **一键合并工作树分支到主分支**（`git merge`）
- 避免来回切分支污染工作目录

### 4. SVN 认证支持

- 支持 `https` 类型 SVN 地址
- 凭据通过 VS Code `SecretStorage` 安全保存
- 先尝试后台认证预热，必要时自动回退到集成终端

### 5. SVN Externals 支持

- 扫描项目中的 `svn:externals`
- 区分目录 external 和文件 external
- 目录 external 可导入为受管项目
- 文件 external 可落地为 `symlink` 或 `copy`
- 已保存的 file external 规则会在创建 worktree 时自动重放

### 6. 项目树与状态栏

- Activity Bar 中集中查看所有项目和工作树
- 状态栏显示当前同步状态
- 支持从项目节点直接执行常用命令

---

## 适用场景

`MGitSVN` 特别适合以下项目：

1. SVN 是事实上的主仓库
2. 开发者通过 `git-svn` 本地开发
3. 一个业务对应多个独立 SVN 模块
4. 需要频繁切换 trunk / branch
5. 需要并行维护多个版本或补丁分支
6. 项目存在 `svn:externals`

如果你的项目是单仓库纯 Git，这个插件通常没有必要。

---

## 快速开始

### 1. 打开一个工作目录

```bash
mkdir -p ~/svn/my-project
cd ~/svn/my-project
code .
```

### 2. 初始化配置

在命令面板中执行：

```text
MGitSVN: 初始化配置
```

初始化后会在工作区根目录生成 `.mgitsvn.json`。

### 3. 编辑配置文件

一个典型配置示例：

```json
{
  "rootDir": "./",
  "projects": [
    {
      "name": "service-config",
      "path": "service-config",
      "svnRemotes": {
        "trunk": "svn://svn.example.com/repos/project/trunk/service-config",
        "branch": "svn://svn.example.com/repos/project/branches/{branch}/service-config"
      },
      "enabled": true
    },
    {
      "name": "service-web",
      "path": "service-web",
      "svnRemotes": {
        "trunk": "svn://svn.example.com/repos/project/trunk/service-web",
        "branch": "svn://svn.example.com/repos/project/branches/{branch}/service-web"
      },
      "enabled": true
    }
  ],
  "worktreeBaseDir": "../",
  "worktreeSync": [
    { "source": "AGENTS.md", "mode": "symlink" },
    { "source": "go.work", "mode": "symlink" }
  ],
  "externals": {
    "autoScanAfterClone": true,
    "directoryMode": "prompt",
    "fileMode": "prompt",
    "defaultFileLinkMode": "symlink",
    "fileRules": [],
    "ignoredDefinitions": []
  }
}
```

### 4. 克隆项目

你可以选择：

- `MGitSVN: 克隆全部项目`
- `MGitSVN: 克隆项目`

如果是 `https` 类型 SVN，第一次执行时可以：

- 让插件弹出凭据输入框
- 或提前执行 `MGitSVN: 管理 SVN 凭据`

### 5. 日常使用

常见日常动作：

- `MGitSVN: 全部更新`
- `MGitSVN: 全部提交`
- `MGitSVN: 切换分支`
- `MGitSVN: 切换 SVN 源（trunk/branch）`
- `MGitSVN: 创建工作树`

---

## 核心工作流

## 场景一：日常同步与提交

1. 执行 `全部更新`
2. 在各子项目中开发
3. 本地正常 `git commit`
4. 执行 `全部提交`

这比逐个目录手工跑 `git svn rebase / dcommit` 更省时间。

## 场景二：切换 SVN branch

1. 执行 `切换 SVN 源（trunk/branch）`
2. 如果配置里包含 `{branch}`，输入实际分支名
3. 插件自动：
   - 添加对应 SVN remote
   - 拉取对应 remote
   - 创建并切换本地分支

## 场景三：并行处理多个分支

1. 执行 `创建工作树`
2. 输入分支名
3. 插件为所有项目创建对应 worktree
4. 选择在新窗口或当前窗口打开

如果你已经配置了 file external 规则，它们也会自动重放到新 worktree 中。

### 合并工作树分支

当在 worktree 中开发完成、代码已提交后，可一键将工作树分支合并到目标分支：

1. 在「工作树」视图中，右键目标工作树 → **合并到主分支**（或点击行内图标）
2. 从分支列表中选择目标分支（如 `trunk`、`master`）
3. 确认后，插件在每个项目的**主仓库**中依次执行 `git checkout <目标>` → `git merge <源分支>`
4. 结果汇总展示，有冲突的项目会单独提醒

## 场景四：处理 SVN Externals

### 扫描

- `MGitSVN: 扫描 SVN Externals`
- `MGitSVN: 扫描项目 Externals`

### 目录 external

可以：

- 手动导入为受管项目
- 或配置自动纳管

导入后会：

- 写入 `.mgitsvn.json` 的 `projects`
- 自动写入父仓库 `.git/info/exclude`
- 后续可参与 `克隆全部项目`、`更新`、`工作树` 等流程

### 文件 external

可以：

- 手动应用到当前项目
- 或配置自动链接

落地后会：

- 生成 file external 规则
- 写回 `.mgitsvn.json`
- 按 `symlink` 或 `copy` 落地到项目目录
- 在 worktree 中自动重放

---

## Externals 自动策略

`externals` 配置支持三种模式：

### `directoryMode`

- `prompt`：扫描到目录 external 后提示是否导入
- `auto-manage`：扫描到目录 external 后自动导入到 `projects`
- `ignore`：忽略目录 external

### `fileMode`

- `prompt`：扫描到 file external 后提示是否应用
- `auto-link`：扫描到 file external 后自动生成规则并落地
- `ignore`：忽略 file external

### `defaultFileLinkMode`

- `symlink`
- `copy`

推荐默认值：

```json
{
  "directoryMode": "prompt",
  "fileMode": "prompt",
  "defaultFileLinkMode": "symlink"
}
```

---

## 命令列表

| 命令 | 说明 |
|------|------|
| `MGitSVN: 全部更新` | 批量执行 `git svn rebase` |
| `MGitSVN: 全部提交` | 批量执行 `git svn dcommit` |
| `MGitSVN: 查看全部状态` | 查看所有仓库状态 |
| `MGitSVN: 切换分支` | 批量切换 / 创建 Git 本地分支 |
| `MGitSVN: 克隆项目` | 克隆单个项目 |
| `MGitSVN: 克隆全部项目` | 克隆配置中的所有项目 |
| `MGitSVN: 切换 SVN 源（trunk/branch）` | 切换目标 SVN remote |
| `MGitSVN: 创建工作树` | 批量创建 worktree |
| `MGitSVN: 删除工作树` | 批量删除 worktree |
| `MGitSVN: 打开工作树` | 打开指定 worktree |
| `MGitSVN: 初始化配置` | 创建 `.mgitsvn.json` |
| `MGitSVN: 打开配置文件` | 打开当前配置文件 |
| `MGitSVN: 查看文档` | 打开 README |
| `MGitSVN: 管理 SVN 凭据` | 录入 / 预热 SVN 认证 |
| `MGitSVN: 清除 SVN 凭据` | 清除保存的 SVN 凭据 |
| `MGitSVN: 扫描 SVN Externals` | 扫描当前工作区全部 externals |
| `MGitSVN: 扫描项目 Externals` | 扫描单个项目的 externals |
| `MGitSVN: 导入项目 Externals` | 将目录 external 导入为受管项目 |
| `MGitSVN: 应用项目 File Externals` | 将 file external 落地到当前项目 |
| `MGitSVN: 重放 File Externals` | 重放已保存的 file external 规则 |
| `MGitSVN: 合并到主分支` | 将工作树分支合并到目标分支 |

---

## 配置说明

## 顶层配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `rootDir` | `string` | 项目根目录，支持相对路径 |
| `projects` | `ProjectConfig[]` | 项目列表 |
| `worktreeBaseDir` | `string` | worktree 根目录 |
| `worktreeSync` | `WorktreeSyncItem[]` | 创建 worktree 时同步的文件/目录 |
| `externals` | `ExternalsConfig` | SVN externals 策略与规则 |

## `projects`

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 项目显示名 |
| `path` | `string` | 相对 `rootDir` 的路径 |
| `svnRemotes` | `Record<string, string>` | 多个 SVN remote |
| `enabled` | `boolean` | 是否启用 |
| `source` | `manual \| external` | 项目来源 |

## `worktreeSync`

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | `string` | 源文件或目录，相对 `rootDir` |
| `mode` | `symlink \| copy` | 同步方式 |

适合把以下内容同步到新 worktree：

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `go.work`
- 项目级工具配置目录

## `externals`

| 字段 | 类型 | 说明 |
|------|------|------|
| `autoScanAfterClone` | `boolean` | clone 后是否自动扫描 externals |
| `directoryMode` | `prompt \| auto-manage \| ignore` | 目录 external 的处理方式 |
| `fileMode` | `prompt \| auto-link \| ignore` | file external 的处理方式 |
| `defaultFileLinkMode` | `symlink \| copy` | file external 默认落地方式 |
| `fileRules` | `FileExternalRule[]` | 已保存的 file external 规则 |
| `ignoredDefinitions` | `string[]` | 需要忽略的 externals 定义 |

---

## VS Code 设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `mgitsvn.concurrency` | `3` | 并发操作数量 |
| `mgitsvn.autoRefresh` | `true` | 操作后自动刷新 |
| `mgitsvn.showNotifications` | `true` | 显示通知 |
| `mgitsvn.showWelcomeMessage` | `true` | 未配置时显示欢迎提示 |
| `mgitsvn.authMode` | `auto` | SVN 认证执行模式 |
| `mgitsvn.rememberCredentials` | `true` | 是否保存 SVN 凭据 |
| `mgitsvn.interactiveTerminalOnAuthFailure` | `true` | 认证失败时是否自动回退到终端 |

---

## 常见问题

### 1. 没初始化配置时能先看文档吗？

可以。欢迎页里的“查看文档”会直接打开 `README.md`，不依赖配置是否已初始化。

### 2. 为什么创建工作树前要求先初始化配置？

因为 worktree 是基于 `.mgitsvn.json` 里的项目列表批量创建的，没有配置就不知道要为哪些仓库创建工作树。

### 3. `https` SVN 认证失败怎么办？

建议先执行：

```text
MGitSVN: 管理 SVN 凭据
```

如果后台认证仍失败，插件会自动尝试回退到集成终端继续执行。

### 4. file external 为什么还要写规则？

因为 `git-svn` 不是 SVN working copy，插件需要把 file external 的来源、落地方式和重放策略保存下来，才能在后续刷新或 worktree 创建时恢复。

### 5. 目录 external 导入后为什么还要再克隆？

导入只是把它纳入 MGitSVN 管理，不会替你自动把目录 external 的代码拉到本地。后续执行 `克隆全部项目` 即可补齐。

---

## 安装

### 从 VSIX 安装

```bash
code --install-extension mgitsvn-0.1.0.vsix
```

如果你使用 Windsurf，也可以用相同方式安装对应的 VSIX。

### 开发模式

```bash
pnpm install
pnpm run compile
```

然后按 `F5` 启动扩展开发宿主。

---

## 版本说明

- 当前准备发布版本：`0.1.0`
- 详细升级日志请查看仓库根目录的 `CHANGELOG.md`

---

## License

MIT
