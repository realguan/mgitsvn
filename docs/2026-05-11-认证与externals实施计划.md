# 认证与 Externals 实施计划

> 当前执行策略：先实现认证主干与 externals 基础模型，再逐步接入 externals 扫描和落地能力。

## 本轮范围

### 第一阶段

1. 为扩展服务层引入运行时上下文，支持 `SecretStorage` 与全局缓存目录。
2. 实现 SVN 凭据保存、读取、删除能力。
3. 实现 SVN 认证预热（auth bootstrap），让 `git svn` 可复用插件管理的 `config-dir`。
4. 新增统一 SVN/Git-SVN 命令执行器，支持：
   - 后台执行
   - 认证失败分类
   - 交互式终端回退
5. 将 `GitSvnAdapter` 改为使用统一执行器。
6. 为后续 externals 支持补齐基础数据模型与配置结构。

### 暂不在本轮完成

1. externals 远端扫描
2. 目录 external 自动纳管
3. 文件 external 自动建链
4. `.git/info/exclude` 自动维护

## 文件计划

### 新增

1. `src/services/RuntimeContextService.ts`
2. `src/services/SvnCredentialService.ts`
3. `src/services/SvnAuthBootstrapService.ts`
4. `src/services/GitSvnCommandRunner.ts`
5. `src/services/SvnAuthErrorClassifier.ts`

### 修改

1. `src/extension.ts`
2. `src/services/index.ts`
3. `src/services/GitSvnAdapter.ts`
4. `src/services/RepositoryManager.ts`
5. `src/commands/CommandHandler.ts`
6. `src/models/types.ts`
7. `package.json`

### 可选新增测试

由于当前工程没有现成测试骨架，本轮先补最小单元测试基础，优先覆盖：

1. `SvnAuthErrorClassifier`
2. `SvnCredentialService` 的 key 归一化和序列化逻辑

## 验收标准

1. 代码可正常编译。
2. `clone/rebase/dcommit/fetch` 统一走新的命令执行器。
3. 遇到认证问题时，插件可以：
   - 录入用户名密码
   - 保存到 `SecretStorage`
   - 用 `svn` 预热认证缓存
   - 重试后台命令
   - 必要时回退到集成终端
4. 配置模型中包含 externals 基础结构，但不影响现有用户配置。

