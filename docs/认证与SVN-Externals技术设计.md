# MGitSVN 认证与 SVN Externals 技术设计

## 1. 背景

`MGitSVN` 当前已经具备多仓库 `git-svn` 批量管理能力，但在真实项目中还有 3 类核心缺口：

1. `https` 类型的 SVN 地址在插件后台执行时无法完成用户名/密码认证。
2. 某些项目使用了 `svn:externals` 引用外部目录，当前只能靠用户手工补充到 `projects`。
3. 某些项目使用了文件级 `svn:externals`，当前没有自动落地能力，用户希望至少能自动建立符号链接。

这些问题本质上都不是单点 bug，而是 `MGitSVN` 还缺少：

- 一套可控的 SVN 认证能力
- 一套对 `svn:externals` 的解析、托管和同步能力

本文档给出完整技术设计，目标是在不推翻 `0.0.12` 现有架构的前提下，补齐这两块能力。

---

## 2. 需求摘要

### 2.1 用户诉求

基于用户反馈，需求可归纳为：

1. 插件执行 `git svn clone / fetch / rebase / dcommit` 时，不能只依赖系统中“已经保存好的密码”。
2. 如果 SVN 仓库中定义了目录级 externals，希望插件能自动识别并辅助 clone。
3. 如果 SVN 仓库中定义了文件级 externals，希望插件能自动在本地建立链接。

### 2.2 设计目标

1. 对 `https` SVN 仓库提供可落地的认证方案。
2. 自动识别目录 external 和文件 external。
3. 将目录 external 纳入现有多仓库管理体系。
4. 将文件 external 作为可重放的同步规则进行管理。
5. 保持 `projects`、`worktree`、批量操作等现有主流程尽量不变。

### 2.3 非目标

第一阶段不做以下内容：

1. 不实现完整的 SVN working copy 语义模拟。
2. 不实现通用的 SVN 凭据代理服务。
3. 不支持所有历史版本 Subversion 的所有 externals 方言，只覆盖常见现代格式并兼容旧格式的主流写法。
4. 不自动修改上游 SVN 的 `svn:externals` 属性。

---

## 3. SVN Externals 基础认知

本设计基于 Subversion 官方文档的 externals 语义。

### 3.1 目录 external

目录 external 是“把另一个版本化目录映射到当前工作副本中的某个相对路径”。

在标准 SVN working copy 中：

1. `svn checkout` / `svn update` 会自动拉取目录 external。
2. external 对应的本地目录与主工作副本是“相互关联但又相对独立”的。
3. 对 external 的提交通常需要显式在 external 对应位置执行命令。

### 3.2 文件 external

文件 external 从 Subversion 1.6 开始支持，表现为：

1. 本地看起来像一个文件。
2. 它来自另一个 SVN 路径映射。
3. 如果 external 指向固定 revision，则通常不可直接提交修改。
4. 文件 external 不能跨仓库引用，要求目标文件和挂载位置在同一 repository 内。

### 3.3 对 `git-svn` 的影响

`git-svn` 得到的是 Git 工作树，而不是 SVN working copy，因此：

1. `git svn clone` 不会自动帮我们生成 externals 的本地结构。
2. 目录 external 不会自动变成嵌套仓库。
3. 文件 external 不会自动出现。

因此插件必须自己补这一层“externals 托管逻辑”。

---

## 4. 当前实现现状与问题

### 4.1 认证现状

当前 `GitSvnAdapter` 通过 `child_process.spawn('git', args)` 在后台执行命令：

- `clone()`：`src/services/GitSvnAdapter.ts`
- `executeGitSvnCommand()`：`src/services/GitSvnAdapter.ts`
- `fetchSvnRemote()`：`src/services/GitSvnAdapter.ts`

当前实现的问题：

1. 后台进程没有可交互终端。
2. 插件没有收集和存储 SVN 凭据的能力。
3. 插件也没有独立的认证失败分类与恢复机制。

这会导致 `https` 仓库一旦需要交互登录，就只能失败或依赖外部已缓存凭据。

### 4.2 externals 现状

当前系统只认识静态 `.mgitsvn.json` 中的 `projects`。

已有的 `worktreeSync` 能力：

1. 只作用于“主工作区根目录 -> worktree 根目录”。
2. 不理解 SVN externals 语义。
3. 不会扫描 SVN 属性，也不会自动 clone 或建链。

因此它不能直接满足 externals 需求，只能复用其中的“软链接/复制”落地能力。

---

## 5. 总体方案概览

### 5.1 核心思路

本方案采用“半自动托管 externals”策略：

1. 认证由插件接管“输入、存储、预热、失败回退”。
2. externals 由插件负责“扫描、解析、展示、确认、落地”。
3. 目录 external 转化为“可管理的嵌套项目”。
4. 文件 external 转化为“可重放的文件链接规则”。

### 5.2 推荐交互策略

1. **优先后台执行**
   - 如果已有有效认证缓存，则直接后台完成。
2. **认证失败后自动补救**
   - 先尝试使用插件保存的凭据预热 SVN auth cache。
   - 如果仍失败，再切换到 VS Code 集成终端执行交互式任务。
3. **externals 不做静默全自动**
   - 默认先展示扫描结果，再让用户确认应用。

### 5.3 目标架构

```text
CommandHandler
  ├─ RepositoryManager
  │   ├─ GitSvnCommandRunner
  │   ├─ SvnCredentialService
  │   ├─ SvnAuthBootstrapService
  │   └─ SvnExternalsService
  ├─ WorktreeManager
  │   ├─ FileExternalLinkManager
  │   └─ ExcludeRuleManager
  └─ ConfigurationManager
      └─ 持久化 managed externals 配置
```

---

## 6. 详细设计

## 6.1 运行时上下文注入

### 6.1.1 设计原因

要支持凭据安全存储与 SVN auth cache，需要拿到：

1. `ExtensionContext.secrets`
2. `globalStorageUri.fsPath`

当前服务层是单例，但没有拿到 `ExtensionContext`。

### 6.1.2 方案

新增 `RuntimeContextService`：

```ts
interface RuntimeContext {
  secrets: vscode.SecretStorage;
  globalStoragePath: string;
}
```

在 `activate()` 中初始化一次，供以下服务使用：

1. `SvnCredentialService`
2. `SvnAuthBootstrapService`
3. `GitSvnCommandRunner`

### 6.1.3 影响文件

1. `src/extension.ts`
2. `src/services/index.ts`
3. 新增 `src/services/RuntimeContextService.ts`

---

## 6.2 SVN 认证设计

## 6.2.1 设计目标

1. 用户无需手工去终端拼命令。
2. 插件可以收集用户名和密码。
3. 凭据不写入 `.mgitsvn.json`。
4. 对 `git svn` 尽量后台完成，对失败场景有稳定回退。

## 6.2.2 认证策略选择

本设计采用“双层认证”：

1. **VS Code SecretStorage**
   - 用于保存插件级用户名/密码。
2. **SVN auth cache**
   - 用于让 `git svn` 和 `svn` 后续命令复用认证结果。

理由：

1. VS Code 有原生密码输入框与安全存储能力。
2. `git svn` 虽支持 `--username`，但并不适合作为“直接喂密码”的主通道。
3. 使用 `svn` 命令先完成认证预热，再执行 `git svn` 更稳定。

## 6.2.3 凭据作用域

凭据按 `repository root URL` 或 `host + repo root` 维度存储。

推荐 key 结构：

```ts
mgitsvn:svn-credential:<normalized-repo-root-url>
```

保存内容：

```ts
interface SvnStoredCredential {
  username: string;
  password: string;
  updatedAt: string;
}
```

说明：

1. 不写入 `.mgitsvn.json`
2. 不出现在日志中
3. 日志里只输出脱敏后的 URL 和 username

## 6.2.4 用户输入方式

使用 VS Code 原生输入框：

1. 用户名：`showInputBox()`
2. 密码：`showInputBox({ password: true })`

可选增加“记住密码”确认框：

1. 记住：保存到 `SecretStorage`
2. 不记住：仅用于本次命令

## 6.2.5 SVN auth cache 预热

新增 `SvnAuthBootstrapService`。

核心思路：

1. 插件先用 `svn info` 或 `svn propget` 对远端 URL 做一次认证。
2. 认证命令显式带上：
   - `--username`
   - `--password-from-stdin`
   - `--non-interactive`
   - `--config-dir <extensionManagedSvnConfigDir>`
3. 成功后，Subversion 会在对应 `config-dir` 下写入 auth cache。
4. 后续 `git svn` 使用同一个 `--config-dir` 即可复用认证状态。

推荐目录：

```text
<globalStoragePath>/svn-auth
```

这样有几个好处：

1. 不污染用户全局 `~/.subversion`
2. 插件行为可控
3. 后续可支持“一键清理认证缓存”

## 6.2.6 `git svn` 执行策略

新增 `GitSvnCommandRunner`，统一所有 SVN 相关命令执行。

支持 3 种模式：

```ts
type CommandExecutionMode = 'background' | 'interactive-task' | 'auto';
```

默认使用 `auto`：

1. 如果已存在 auth cache，则后台执行。
2. 如果后台失败且识别为认证错误，则尝试使用已保存凭据做 auth bootstrap。
3. bootstrap 成功后重试后台执行。
4. 如果仍失败，则转为 `interactive-task`。

## 6.2.7 交互式终端回退

当以下情况出现时，自动切换到 VS Code 集成终端任务：

1. 未保存凭据，且后台执行需要认证
2. 证书确认需要人工处理
3. `git svn` 后台流程继续要求交互输入

实现方式：

1. 使用 `vscode.Task + ShellExecution`
2. 在集成终端中执行原始命令
3. 通过 `tasks.onDidEndTaskProcess` 获取退出码
4. 成功后自动触发 refresh

用户体验不是“手工自己敲命令”，而是：

1. 插件自动打开终端
2. 插件自动填好命令
3. 用户只在需要时输入账号密码或确认服务器证书

## 6.2.8 认证错误识别

新增 `SvnAuthErrorClassifier`，根据退出码与 stderr 文本判断是否为认证类错误。

关键匹配关键词：

1. `authorization failed`
2. `Authentication failed`
3. `E170001`
4. `E215004`
5. `Unable to connect to a repository`
6. `Interactive prompting is disabled`
7. `Server certificate verification failed`

如果分类器误判，回退策略仍然安全：最多转终端，不会造成数据破坏。

## 6.2.9 证书处理

默认策略：

1. 后台非交互命令不自动信任非法证书
2. 证书异常时转集成终端，由用户确认

不建议第一版直接在后台加 `--trust-server-cert-failures`，避免误接受异常证书。

---

## 6.3 externals 扫描与解析设计

## 6.3.1 扫描入口

新增 `SvnExternalsService`，负责：

1. 扫描某个项目的 externals
2. 解析 externals 定义
3. 归一化成插件内部模型

扫描时机：

1. `cloneProject` 成功后
2. `cloneAllProjects` 每个项目成功后
3. 手工命令：`MGitSVN: Scan SVN Externals`
4. 可选：`switchSvnRemote` 成功后重新扫描

## 6.3.2 为什么不能直接扫描本地目录

当前项目是 `git-svn` 仓库，不是 SVN working copy，因此不能依赖本地 `.svn` 元信息。

正确方案是基于远端 URL 扫描属性：

```bash
svn propget svn:externals -R --xml <svnUrl>
```

其中 `<svnUrl>` 使用当前项目实际 tracking 的 SVN URL。

## 6.3.3 解析输入格式

需要兼容两类 externals 定义格式：

1. **新格式**
   - `[-rREV] URL localPath`
2. **旧格式**
   - `localPath [-rREV] URL`

同时支持：

1. 绝对 URL
2. 相对 URL（如 `^/`、`../`、`//`、`/`）
3. 带 peg revision 的 URL（如 `^/path/file@40`）
4. 带引号或转义空格的本地路径

## 6.3.4 内部模型

```ts
interface ParsedExternalDefinition {
  ownerProject: string;
  ownerProjectPath: string;
  propertyTargetUrl: string;
  propertyTargetRelativePath: string;
  localRelativePath: string;
  externalUrl: string;
  externalRevision?: string;
  pegRevision?: string;
  rawLine: string;
  kind: 'directory' | 'file' | 'unknown';
}
```

### `kind` 判定规则

优先使用远端 `svn info` 判断目标 URL 是 `dir` 还是 `file`：

1. `svn info --show-item kind <resolvedUrl>`
2. 如果失败，记为 `unknown`
3. `unknown` 在 UI 中展示但不自动落地

## 6.3.5 相对 URL 解析

对以下格式做归一化：

1. `^/path`：相对 repository root
2. `../path`：相对 property 所在目录
3. `//path`：相对当前协议
4. `/path`：相对当前服务器根

解析结果统一为绝对 URL。

## 6.3.6 扫描结果组织

```ts
interface SvnExternalsScanResult {
  ownerProject: string;
  scannedUrl: string;
  directoryExternals: ParsedExternalDefinition[];
  fileExternals: ParsedExternalDefinition[];
  unknownExternals: ParsedExternalDefinition[];
}
```

---

## 6.4 目录 external 托管设计

## 6.4.1 核心思想

目录 external 最终转为“嵌套项目”，纳入现有 `projects` 体系管理。

例如：

```text
主项目: st_web
external: third_party/common -> ^/libs/common
```

会落为：

```json
{
  "name": "st_web:third_party/common",
  "path": "st_web/third_party/common",
  "svnRemotes": {
    "external": "https://svn.example.com/repos/libs/common"
  },
  "source": "external",
  "external": {
    "ownerProject": "st_web",
    "localRelativePath": "third_party/common",
    "rawLine": "^/libs/common third_party/common"
  }
}
```

## 6.4.2 为什么复用 `projects`

这样可以直接继承现有能力：

1. `cloneAllProjects`
2. `rebaseAll`
3. `dcommitAll`
4. `switchSvnRemote`
5. `worktree`

同时避免新增一套平行的“目录 external 仓库管理逻辑”。

## 6.4.3 需要补充的元数据

扩展 `ProjectConfig`：

```ts
interface ProjectConfig {
  name: string;
  path: string;
  svnRemotes: Record<string, string>;
  enabled?: boolean;
  source?: 'manual' | 'external';
  external?: {
    ownerProject: string;
    localRelativePath: string;
    rawLine: string;
    propertyTargetUrl: string;
  };
}
```

## 6.4.4 clone 顺序控制

目录 external 常常是嵌套在主项目目录之下，因此 `cloneAllProjects()` 需要按路径深度排序：

1. 先 clone 父项目
2. 再 clone 子路径 external 项目

排序规则：

1. `path` 层级浅的优先
2. 同层保持原顺序

## 6.4.5 状态噪音处理

目录 external 会在父 Git 仓库内生成一个嵌套仓库目录，这在 Git 看来通常是“未跟踪目录”。

为避免父项目状态被污染，插件需要自动维护父仓库的：

```text
.git/info/exclude
```

将 external 的本地路径写入 exclude，保证：

1. 父项目状态仍然干净
2. 状态栏和项目树不被 external 目录误伤

## 6.4.6 worktree 兼容

由于目录 external 已经变成嵌套项目：

1. 主项目创建 worktree 时，external 项目也会作为独立项目创建对应 worktree。
2. 路径结构仍然保持在父项目子路径下。

这样可以较自然地复现原始 externals 目录结构。

---

## 6.5 文件 external 托管设计

## 6.5.1 核心思想

文件 external 不适合转为项目，因为它不是仓库根。

因此采用“规则化同步”方案：

1. 扫描到文件 external 后
2. 生成一条本地文件映射规则
3. 按规则创建 `symlink` 或 `copy`

## 6.5.2 内部配置模型

```ts
interface FileExternalRule {
  ownerProject: string;
  ownerProjectPath: string;
  localRelativePath: string;
  sourceUrl: string;
  sourceRevision?: string;
  linkMode: 'symlink' | 'copy';
  rawLine: string;
  enabled: boolean;
}
```

将其保存到 `.mgitsvn.json`：

```ts
interface ExternalsConfig {
  autoScanAfterClone?: boolean;
  directoryMode?: 'prompt' | 'auto-manage' | 'ignore';
  fileMode?: 'prompt' | 'auto-link' | 'ignore';
  defaultFileLinkMode?: 'symlink' | 'copy';
  fileRules?: FileExternalRule[];
  ignoredDefinitions?: string[];
}
```

## 6.5.3 本地落地策略

第一阶段默认推荐：

1. `symlink`

原因：

1. 落地成本低
2. 可以复用现有 `worktreeSync` 的实现方式
3. 不会产生多份文件副本

在以下场景允许降级为 `copy`：

1. 文件系统不支持符号链接
2. 用户显式配置 `copy`

## 6.5.4 文件来源准备

文件 external 需要先拿到源文件内容或源文件本地载体。

推荐实现：

1. 对每个 file external，在插件管理目录建立一个缓存源：
   - `<globalStoragePath>/externals-cache/<hash>`
2. 使用 `svn export <sourceUrl>` 拉取源文件到缓存目录
3. 再从缓存目录向目标项目建立 `symlink` 或执行 `copy`

原因：

1. 本地不能直接对远端 URL 建符号链接
2. 使用 `svn export` 不会生成 `.svn` 元信息
3. 缓存目录可被多个项目或 worktree 复用

## 6.5.5 状态噪音处理

与目录 external 一样，自动生成的链接文件对父 Git 仓库而言也会是未跟踪项。

同样需要写入父仓库：

```text
.git/info/exclude
```

以免污染仓库状态。

## 6.5.6 worktree 兼容

创建 worktree 后，需要为每个目标 worktree 重新应用 file external 规则：

1. 计算 worktree 对应的 ownerProject 根路径
2. 在 worktree 中重建目标链接/文件
3. 更新 worktree 中主项目的 `.git/info/exclude`

这部分逻辑不应复用现有 `worktreeSync` 配置，而应新增专门的 `FileExternalLinkManager`。

## 6.5.7 提交行为限制

根据 SVN 官方语义，文件 external 如果 pin 到固定 revision，则不应被当作可直接提交文件。

因此第一阶段明确限制：

1. 插件创建的 file external 一律作为“只读派生文件”处理。
2. 不将其纳入 `dcommit` 提交路径。
3. 如果用户需要修改，必须修改源文件或调整 externals 定义。

---

## 6.6 配置设计

## 6.6.1 `.mgitsvn.json` 新结构

```json
{
  "rootDir": "./",
  "projects": [],
  "worktreeBaseDir": "../",
  "worktreeSync": [],
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

### 字段说明

1. `directoryMode`
   - `prompt`: 扫描后询问是否纳管
   - `auto-manage`: 自动加入 `projects`
   - `ignore`: 只展示不处理
2. `fileMode`
   - `prompt`: 扫描后询问是否建链
   - `auto-link`: 自动创建规则并落地
   - `ignore`: 只展示不处理

## 6.6.2 VS Code 设置

认证策略不写入项目配置，新增为 VS Code 设置：

```json
{
  "mgitsvn.authMode": "auto",
  "mgitsvn.rememberCredentials": true,
  "mgitsvn.interactiveTerminalOnAuthFailure": true
}
```

说明：

1. 这是用户偏好，不应进入项目配置文件。
2. 密码本体始终只保存在 SecretStorage，不保存在 settings.json。

---

## 6.7 新增命令与交互设计

## 6.7.1 新增命令

1. `mgitsvn.scanExternals`
   - 扫描当前工作区所有项目的 externals
2. `mgitsvn.scanProjectExternals`
   - 扫描单个项目的 externals
3. `mgitsvn.manageSvnCredential`
   - 手工录入/更新 SVN 凭据
4. `mgitsvn.clearSvnCredential`
   - 清理已保存凭据与 SVN auth cache
5. `mgitsvn.reapplyFileExternals`
   - 重新应用文件 external 规则

## 6.7.2 clone 后交互

项目 clone 成功后：

1. 如果未开启 externals 扫描，流程结束。
2. 如果扫描到 externals：
   - 通知显示“发现 N 个目录 external，M 个文件 external”
   - 提供操作：
     - `查看详情`
     - `纳管目录 external`
     - `应用文件 external`
     - `忽略本次`

## 6.7.3 认证交互

后台命令遇到认证问题时：

1. 若无凭据：
   - 先弹用户名输入框
   - 再弹密码输入框
2. 若有凭据但失败：
   - 提示凭据可能失效
   - 支持重新输入
3. 若仍需交互：
   - 弹窗说明将切换到终端继续认证

---

## 6.8 数据模型变更

建议在 `src/models/types.ts` 新增：

```ts
export interface MgitsvnExternalsConfig {
  autoScanAfterClone?: boolean;
  directoryMode?: 'prompt' | 'auto-manage' | 'ignore';
  fileMode?: 'prompt' | 'auto-link' | 'ignore';
  defaultFileLinkMode?: 'symlink' | 'copy';
  fileRules?: FileExternalRule[];
  ignoredDefinitions?: string[];
}

export interface ProjectExternalMeta {
  ownerProject: string;
  localRelativePath: string;
  rawLine: string;
  propertyTargetUrl: string;
}

export interface FileExternalRule {
  ownerProject: string;
  ownerProjectPath: string;
  localRelativePath: string;
  sourceUrl: string;
  sourceRevision?: string;
  linkMode: 'symlink' | 'copy';
  rawLine: string;
  enabled: boolean;
}

export interface SvnStoredCredential {
  username: string;
  password: string;
  updatedAt: string;
}
```

并扩展 `ProjectConfig`：

```ts
source?: 'manual' | 'external';
external?: ProjectExternalMeta;
```

---

## 6.9 模块拆分建议

### 6.9.1 新增服务

1. `src/services/RuntimeContextService.ts`
2. `src/services/SvnCredentialService.ts`
3. `src/services/SvnAuthBootstrapService.ts`
4. `src/services/GitSvnCommandRunner.ts`
5. `src/services/SvnExternalsService.ts`
6. `src/services/FileExternalLinkManager.ts`
7. `src/services/ExcludeRuleManager.ts`

### 6.9.2 现有模块改造

1. `GitSvnAdapter`
   - 不再自己直接 `spawn`
   - 改为委托给 `GitSvnCommandRunner`
2. `RepositoryManager`
   - clone 成功后触发 externals 扫描与应用
   - cloneAll 按路径深度排序
3. `WorktreeManager`
   - 创建 worktree 后额外应用 file external 规则
4. `ConfigurationManager`
   - 增加 externals 配置的读写与迁移
5. `CommandHandler`
   - 增加 externals 与 credential 相关命令

---

## 6.10 关键流程

## 6.10.1 `cloneProject` 流程

```text
输入 SVN URL
  -> 检查是否存在凭据
  -> 若无凭据且为 https，提示录入凭据
  -> 执行 auth bootstrap
  -> git svn clone
  -> clone 成功后刷新仓库
  -> 扫描 externals
  -> 展示扫描结果
  -> 用户确认纳管/建链
  -> 应用 exclude 规则
```

## 6.10.2 `cloneAllProjects` 流程

```text
按 path 深度排序项目
  -> 逐个 clone
  -> 每个成功项目独立扫描 externals
  -> 收集所有扫描结果
  -> 结束后统一弹出摘要
```

## 6.10.3 `createWorktreeAll` 流程

```text
批量创建 worktree
  -> 生成 workspace 文件
  -> 应用 worktreeSync
  -> 应用 file external 规则
  -> 写入 worktree 对应 exclude 规则
  -> 刷新视图
```

---

## 6.11 日志与可观测性

日志必须满足：

1. 密码永不出现在日志中
2. URL 中若嵌入用户名，应脱敏后输出
3. 对每条 externals 处理结果给出明确记录

推荐日志事件：

1. `auth-bootstrap-start`
2. `auth-bootstrap-success`
3. `auth-bootstrap-failed`
4. `externals-scan-start`
5. `externals-scan-result`
6. `external-directory-managed`
7. `external-file-linked`
8. `interactive-terminal-fallback`

---

## 7. 风险与边界

## 7.1 目录 external 的 Git 状态污染

风险：

1. 嵌套仓库会被父仓库识别为未跟踪目录。

对策：

1. 自动维护 `.git/info/exclude`
2. 所有自动生成路径都写入 exclude

## 7.2 文件 external 不等价于 SVN 原生 working copy 语义

风险：

1. 我们生成的是缓存文件 + 本地链接，不是 SVN file external 的原生实体。

对策：

1. 第一阶段定义为“开发期便利同步”
2. 文档中明确其为只读派生文件

## 7.3 externals 解析复杂度

风险：

1. externals 语法存在历史格式、相对 URL、引号、转义等复杂情况。

对策：

1. 第一阶段支持最常见格式
2. 对无法解析的定义保留原文并展示，不自动处理

## 7.4 认证与证书交互

风险：

1. 某些 SVN 服务器存在证书或代理环境差异。

对策：

1. 后台失败统一允许转交互终端
2. 不在第一阶段自动信任异常证书

---

## 8. 备选方案比较

## 8.1 方案 A：只修认证，不做 externals

优点：

1. 成本最低

缺点：

1. 用户第二、三条诉求完全无法解决

## 8.2 方案 B：全自动静默 externals

优点：

1. 用户体验最好

缺点：

1. 风险高
2. 一旦路径冲突或认证异常，排查困难

## 8.3 方案 C：半自动托管 externals

优点：

1. 能解决真实问题
2. 风险可控
3. 与当前架构兼容最好

缺点：

1. 需要新增 5 到 7 个服务模块

**推荐结论：采用方案 C。**

---

## 9. 分阶段实施建议

## Phase 1：认证基础能力

目标：

1. 新增 `SvnCredentialService`
2. 新增 auth bootstrap
3. 新增后台失败后转终端任务执行

验收标准：

1. `https` SVN 仓库可在插件中完成 clone
2. 用户无需手工拼命令

## Phase 2：externals 扫描

目标：

1. 新增 `SvnExternalsService`
2. 可扫描并分类 directory/file externals
3. UI 能展示扫描摘要

验收标准：

1. 用户可以看见每个项目的 externals 列表

## Phase 3：目录 external 纳管

目标：

1. 目录 external 可转为嵌套 project
2. cloneAll 支持路径深度排序
3. 自动维护 `.git/info/exclude`

验收标准：

1. 目录 external 能被自动 clone 并参与批量操作

## Phase 4：文件 external 建链

目标：

1. 建立 file external 缓存与链接规则
2. worktree 中可重建 file external

验收标准：

1. 文件 external 在主工作区和 worktree 中都能落地

---

## 10. 测试设计

## 10.1 单元测试

重点覆盖：

1. externals 行解析
2. 相对 URL 归一化
3. 认证错误分类
4. path 深度排序
5. `.git/info/exclude` 合并写入

建议文件：

1. `src/services/__tests__/SvnExternalsService.test.ts`
2. `src/services/__tests__/SvnCredentialService.test.ts`
3. `src/services/__tests__/GitSvnCommandRunner.test.ts`

## 10.2 集成测试

重点覆盖：

1. 认证成功路径
2. 认证失败后终端回退路径
3. 目录 external 自动纳管
4. 文件 external 建链
5. worktree 中 external 规则重放

## 10.3 手工验证矩阵

至少验证以下场景：

1. `svn://` 仓库，无认证
2. `https://` 仓库，有密码认证
3. 目录 external，绝对 URL
4. 目录 external，相对 URL `^/`
5. 文件 external，HEAD 引用
6. 文件 external，固定 revision
7. 创建 worktree 后 external 是否存在

---

## 11. 未决策项

以下问题建议在开始实现前确认：

1. **密码是否默认保存**
   - 建议默认允许“记住密码”，但由用户确认。
2. **目录 external 是否默认自动纳管**
   - 建议默认 `prompt`。
3. **文件 external 默认 `symlink` 还是 `copy`**
   - 建议默认 `symlink`。
4. **是否允许后台自动信任异常证书**
   - 建议第一阶段不允许。

---

## 12. 最终结论

本设计的关键判断如下：

1. `https` 认证问题不能只靠当前后台 `spawn` 修复，必须引入“凭据输入 + auth bootstrap + 终端回退”。
2. 目录 external 最适合转成“嵌套项目”，复用 `projects` 主模型。
3. 文件 external 最适合转成“缓存源 + 链接规则”，而不是硬塞进 `projects`。
4. 自动生成的目录与文件都需要配套维护 `.git/info/exclude`，否则会污染父项目状态。
5. 整体上采用“半自动托管 externals”最稳，既能满足用户需求，也不会让插件瞬间演变成高风险黑盒。

---

## 参考资料

1. Subversion Externals Definitions
   - https://svnbook.red-bean.com/en/1.8/svn.advanced.externals.html
2. Subversion `svn propget`
   - https://svnbook.red-bean.com/en/1.8/svn.ref.svn.c.propget.html
3. VS Code SecretStorage API
   - https://code.visualstudio.com/api/references/vscode-api#SecretStorage

