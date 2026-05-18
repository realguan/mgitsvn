import * as vscode from 'vscode';
import * as path from 'path';
import {
  ConfigurationManager,
  DirectoryExternalProjectManager,
  ExcludeRuleManager,
  ExternalsAutoManageStrategy,
  ExternalsSummaryHelper,
  FileExternalLinkManager,
  FileExternalRuleHelper,
  GitSvnCommandRunner,
  RepositoryManager,
  SvnCredentialService,
  SvnExternalsService,
  WorktreeManager,
} from '../services';
import {
  ProjectTreeProvider,
  ProjectTreeItem,
  WorktreeTreeProvider,
  WorktreeTreeItem,
  StatusBarProvider,
} from '../providers';
import { buildExtensionId, buildMarketplaceItemUrl, logger } from '../utils';
import { BatchResult, OperationResult } from '../models';
import { SvnExternalsScanResult } from '../services/SvnExternalsService';

/**
 * 命令处理器
 * 注册和处理所有插件命令
 */
export class CommandHandler {
  private configManager: ConfigurationManager;
  private repoManager: RepositoryManager;
  private worktreeManager: WorktreeManager;
  private credentialService: SvnCredentialService;
  private commandRunner: GitSvnCommandRunner;
  private externalsService: SvnExternalsService;
  private excludeRuleManager: ExcludeRuleManager;
  private fileExternalLinkManager: FileExternalLinkManager;
  private projectTreeProvider: ProjectTreeProvider;
  private worktreeTreeProvider: WorktreeTreeProvider;
  private statusBarProvider: StatusBarProvider;

  constructor(
    projectTreeProvider: ProjectTreeProvider,
    worktreeTreeProvider: WorktreeTreeProvider,
    statusBarProvider: StatusBarProvider
  ) {
    this.configManager = ConfigurationManager.getInstance();
    this.repoManager = RepositoryManager.getInstance();
    this.worktreeManager = WorktreeManager.getInstance();
    this.credentialService = new SvnCredentialService();
    this.commandRunner = GitSvnCommandRunner.getInstance();
    this.externalsService = SvnExternalsService.getInstance();
    this.excludeRuleManager = new ExcludeRuleManager();
    this.fileExternalLinkManager = new FileExternalLinkManager();
    this.projectTreeProvider = projectTreeProvider;
    this.worktreeTreeProvider = worktreeTreeProvider;
    this.statusBarProvider = statusBarProvider;
  }

  /**
   * 注册所有命令
   */
  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('mgitsvn.rebaseAll', () => this.rebaseAll()),
      vscode.commands.registerCommand('mgitsvn.dcommitAll', () => this.dcommitAll()),
      vscode.commands.registerCommand('mgitsvn.statusAll', () => this.statusAll()),
      vscode.commands.registerCommand('mgitsvn.checkoutBranch', () => this.checkoutBranch()),
      vscode.commands.registerCommand('mgitsvn.createWorktree', () => this.createWorktree()),
      vscode.commands.registerCommand('mgitsvn.removeWorktree', (item) => this.removeWorktree(item)),
      vscode.commands.registerCommand('mgitsvn.openWorktree', (item) => this.openWorktree(item)),
      vscode.commands.registerCommand('mgitsvn.cloneProject', () => this.cloneProject()),
      vscode.commands.registerCommand('mgitsvn.cloneAllProjects', () => this.cloneAllProjects()),
      vscode.commands.registerCommand('mgitsvn.refresh', () => this.refresh()),
      vscode.commands.registerCommand('mgitsvn.initConfig', () => this.initConfig()),
      vscode.commands.registerCommand('mgitsvn.rebaseProject', (item) => this.rebaseProject(item)),
      vscode.commands.registerCommand('mgitsvn.dcommitProject', (item) => this.dcommitProject(item)),
      vscode.commands.registerCommand('mgitsvn.switchSvnRemote', () => this.switchSvnRemote()),
      vscode.commands.registerCommand('mgitsvn.openInTerminal', (item) => this.openInTerminal(item)),
      vscode.commands.registerCommand('mgitsvn.openConfig', () => this.openConfig()),
      vscode.commands.registerCommand('mgitsvn.openDocumentation', () => this.openDocumentation()),
      vscode.commands.registerCommand('mgitsvn.openWorktreeFolder', (item) => this.openWorktreeFolder(item)),
      vscode.commands.registerCommand('mgitsvn.manageSvnCredential', () => this.manageSvnCredential()),
      vscode.commands.registerCommand('mgitsvn.clearSvnCredential', () => this.clearSvnCredential()),
      vscode.commands.registerCommand('mgitsvn.scanExternals', () => this.scanExternals()),
      vscode.commands.registerCommand('mgitsvn.scanProjectExternals', (item) => this.scanProjectExternals(item)),
      vscode.commands.registerCommand('mgitsvn.importProjectExternals', (item) => this.importProjectExternals(item)),
      vscode.commands.registerCommand('mgitsvn.applyProjectFileExternals', (item) => this.applyProjectFileExternals(item)),
      vscode.commands.registerCommand('mgitsvn.reapplyFileExternals', () => this.reapplyFileExternals()),
      vscode.commands.registerCommand('mgitsvn.mergeWorktree', (item) => this.mergeWorktree(item))
    );
  }

  /**
   * 批量 rebase
   */
  private async rebaseAll(): Promise<void> {
    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MGitSVN: 正在更新所有项目',
        cancellable: true,
      },
      async (progress, token) => {
        logger.show();
        this.statusBarProvider.showBusy('正在更新...');

        const result = await this.repoManager.rebaseAll((current, total, name) => {
          if (token.isCancellationRequested) {
            return;
          }
          progress.report({
            message: `${name} (${current}/${total})`,
            increment: (1 / total) * 100,
          });
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.showBatchResult('更新', result, elapsed);
        // 显示所有变更详情
        result.results.forEach(r => this.logOperationResult(r));
        this.statusBarProvider.update();
        this.projectTreeProvider.refresh();
      }
    );
  }

  /**
   * 批量 dcommit
   */
  private async dcommitAll(): Promise<void> {
    // 检查未提交变更数
    const repos = this.repoManager.getRepositories();
    const modifiedRepos = repos.filter(r => r.uncommittedChanges > 0);
    const gitSvnRepos = repos.filter(r => r.isGitSvn);

    if (gitSvnRepos.length === 0) {
      vscode.window.showInformationMessage('没有 git-svn 仓库可以提交');
      return;
    }

    // 如果有未提交的变更，给出警告
    let confirmMessage = `确定要将 ${gitSvnRepos.length} 个项目提交到 SVN 吗？`;
    if (modifiedRepos.length > 0) {
      confirmMessage += `\n\n⚠️ 注意: ${modifiedRepos.length} 个项目有未暂存的本地修改（${modifiedRepos.map(r => r.name).join(', ')}），这些修改不会被提交。`;
    }

    const confirm = await vscode.window.showWarningMessage(
      confirmMessage,
      { modal: true },
      '确定'
    );

    if (confirm !== '确定') {
      return;
    }

    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MGitSVN: 正在提交所有项目',
        cancellable: true,
      },
      async (progress, token) => {
        logger.show();
        this.statusBarProvider.showBusy('正在提交...');

        const result = await this.repoManager.dcommitAll((current, total, name) => {
          if (token.isCancellationRequested) {
            return;
          }
          progress.report({
            message: `${name} (${current}/${total})`,
            increment: (1 / total) * 100,
          });
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.showBatchResult('提交', result, elapsed);
        this.statusBarProvider.update();
        this.projectTreeProvider.refresh();
      }
    );
  }

  /**
   * 显示所有仓库状态
   */
  private async statusAll(): Promise<void> {
    const repos = this.repoManager.getRepositories();

    if (repos.length === 0) {
      vscode.window.showInformationMessage('未找到项目');
      return;
    }

    const items = repos.map((repo) => {
      const icon =
        repo.state === 'clean'
          ? '✅'
          : repo.state === 'modified'
            ? '⚠️'
            : '❌';
      return {
        label: `${icon} ${repo.name}`,
        description: repo.branch,
        detail: `${repo.uncommittedChanges} 个改动 | ${repo.isGitSvn ? 'git-svn' : '仅 git'}`,
      };
    });

    await vscode.window.showQuickPick(items, {
      title: '项目状态概览',
      placeHolder: `共 ${repos.length} 个项目，${repos.filter(r => r.state === 'clean').length} 个干净，${repos.filter(r => r.state !== 'clean').length} 个有变更`,
    });
  }

  /**
   * 切换分支
   */
  private async checkoutBranch(): Promise<void> {
    const branches = await this.repoManager.getAllBranches();
    const repos = this.repoManager.getRepositories();
    const currentBranches = new Set(repos.map((r) => r.branch));

    // 获取最常见的当前分支
    const branchCounts = new Map<string, number>();
    repos.forEach((r) => {
      branchCounts.set(r.branch, (branchCounts.get(r.branch) || 0) + 1);
    });
    const mainBranch = Array.from(branchCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    // 分离当前分支和其他分支
    const currentBranchItems: vscode.QuickPickItem[] = [];
    const otherBranchItems: vscode.QuickPickItem[] = [];

    for (const branch of branches) {
      if (currentBranches.has(branch)) {
        const count = branchCounts.get(branch) || 0;
        currentBranchItems.push({
          label: `$(check) ${branch}`,
          description: branch === mainBranch
            ? `当前 (${count}/${repos.length} 个项目)`
            : `当前 (${count} 个项目)`,
        });
      } else {
        otherBranchItems.push({
          label: `$(git-branch) ${branch}`,
          description: '',
        });
      }
    }

    // 组合列表：创建新分支 -> 分隔符 -> 当前分支 -> 分隔符 -> 其他分支
    const items: vscode.QuickPickItem[] = [
      { label: '$(add) 创建新分支...', description: '' },
    ];
    if (currentBranchItems.length > 0) {
      items.push({ label: '当前分支', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
      items.push(...currentBranchItems);
    }
    if (otherBranchItems.length > 0) {
      items.push({ label: '其他分支', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
      items.push(...otherBranchItems);
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: '切换分支',
      placeHolder: `当前主要分支: ${mainBranch || '未知'}，共 ${repos.length} 个项目`,
    });

    if (!selected) {
      return;
    }

    let branchName: string;

    if (selected.label.includes('创建新分支')) {
      const input = await vscode.window.showInputBox({
        prompt: '输入新分支名称',
        placeHolder: 'feature/xxx',
        validateInput: (value) => {
          if (!value || value.trim() === '') {
            return '分支名称不能为空';
          }
          if (/\s/.test(value)) {
            return '分支名称不能包含空格';
          }
          return null;
        },
      });
      if (!input) {
        return;
      }
      branchName = input;
    } else {
      // 移除前缀 icon
      branchName = selected.label.replace(/^\$\([^)]+\)\s+/, '');
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在切换到 ${branchName}`,
        cancellable: false,
      },
      async (progress) => {
        this.statusBarProvider.showBusy(`正在切换到 ${branchName}...`);

        const result = await this.repoManager.checkoutAll(branchName, (current, total, name) => {
          progress.report({
            message: `${name} (${current}/${total})`,
            increment: (1 / total) * 100,
          });
        });

        this.showBatchResult('切换分支', result);
        this.statusBarProvider.update();
        this.projectTreeProvider.refresh();
      }
    );
  }

  /**
   * 创建 worktree
   */
  private async createWorktree(): Promise<void> {
    const config = this.configManager.getConfig();
    if (!config || !this.configManager.getConfigFilePath()) {
      const action = await vscode.window.showInformationMessage(
        '请先初始化 MGitSVN 配置，然后再创建工作树。',
        '初始化配置',
        '查看文档'
      );

      if (action === '初始化配置') {
        await vscode.commands.executeCommand('mgitsvn.initConfig');
      } else if (action === '查看文档') {
        await this.openDocumentation();
      }
      return;
    }

    // 获取已有 worktree 列表，用于冲突检测
    const existingWorktrees = await this.worktreeManager.listWorktrees();
    const existingBranches = existingWorktrees.map((wt) => wt.branch);

    const branchName = await vscode.window.showInputBox({
      prompt: '输入工作树的分支名称',
      placeHolder: existingBranches.length > 0
        ? `已有: ${existingBranches.join(', ')}`
        : 'feature/xxx',
      validateInput: (value) => {
        if (!value || value.trim() === '') {
          return '分支名称不能为空';
        }
        if (/\s/.test(value)) {
          return '分支名称不能包含空格';
        }
        if (/[~^:?*\[\]\\]/.test(value)) {
          return '分支名称包含非法字符';
        }
        if (existingBranches.includes(value)) {
          return `工作树 "${value}" 已存在`;
        }
        return null;
      },
    });

    if (!branchName) {
      return;
    }

    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在为 ${branchName} 创建工作树`,
        cancellable: true,
      },
      async (progress, token) => {
        const result = await this.worktreeManager.createWorktreeAll(
          branchName,
          (current, total, name) => {
            if (token.isCancellationRequested) {
              return;
            }
            progress.report({
              message: `${name} (${current}/${total})`,
              increment: (1 / total) * 100,
            });
          }
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.showBatchResult('创建工作树', result, elapsed);

        // 刷新工作树视图
        await this.worktreeTreeProvider.loadWorktrees();

        // 询问是否打开新工作区
        if (result.successCount > 0) {
          const openOptions = [
            { label: '$(window) 新窗口打开', description: '在新的 VS Code 窗口中打开', newWindow: true },
            { label: '$(folder-opened) 当前窗口打开', description: '在当前窗口中打开', newWindow: false },
            { label: '$(close) 暂不打开', description: '稍后手动打开', newWindow: null },
          ];

          const openChoice = await vscode.window.showQuickPick(openOptions, {
            title: `✅ 已为 ${branchName} 创建工作树 (${elapsed}s)`,
            placeHolder: '选择打开方式',
          });

          if (openChoice && openChoice.newWindow !== null) {
            await this.worktreeManager.openWorktree(branchName, openChoice.newWindow);
          }
        }
      }
    );
  }

  /**
   * 删除 worktree
   */
  private async removeWorktree(item?: WorktreeTreeItem): Promise<void> {
    let branchName: string;
    let worktreeInfo: any;

    if (item?.worktreeInfo) {
      branchName = item.worktreeInfo.branch;
      worktreeInfo = item.worktreeInfo;
    } else {
      const worktrees = await this.worktreeManager.listWorktrees();
      const rootDir = this.configManager.getRootDir();

      const items = worktrees
        .filter((wt) => wt.rootPath !== rootDir)
        .map((wt) => {
          const existingCount = wt.projects.filter((p) => p.exists).length;
          return {
            label: `$(git-branch) ${wt.branch}`,
            description: `${existingCount}/${wt.projects.length} 个项目`,
            detail: `$(folder) ${wt.rootPath}`,
            branch: wt.branch,
            info: wt,
          };
        });

      if (items.length === 0) {
        vscode.window.showInformationMessage('没有可删除的工作树');
        return;
      }

      const selected = await vscode.window.showQuickPick(items, {
        title: '删除工作树',
        placeHolder: '选择要删除的工作树（此操作不可逆）',
      });

      if (!selected) {
        return;
      }

      branchName = selected.branch;
      worktreeInfo = selected.info;
    }

    // 构建详细的确认信息
    const projectCount = worktreeInfo?.projects?.length ?? 0;
    const rootPath = worktreeInfo?.rootPath ?? '';
    const confirmMessage = [
      `确定要删除 "${branchName}" 的工作树吗？`,
      '',
      `📁 路径: ${rootPath}`,
      `📦 项目: ${projectCount} 个`,
      '',
      '⚠️ 此操作会删除工作树目录下的所有文件，且不可恢复。',
    ].join('\n');

    const confirm = await vscode.window.showWarningMessage(
      confirmMessage,
      { modal: true },
      '确定删除'
    );

    if (confirm !== '确定删除') {
      return;
    }

    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在删除 ${branchName} 的工作树`,
        cancellable: false,
      },
      async (progress) => {
        const result = await this.worktreeManager.removeWorktreeAll(
          branchName,
          (current, total, name) => {
            progress.report({
              message: `${name} (${current}/${total})`,
              increment: (1 / total) * 100,
            });
          }
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.showBatchResult('删除工作树', result, elapsed);

        // 刷新工作树视图
        await this.worktreeTreeProvider.loadWorktrees();
      }
    );
  }

  /**
   * 合并 worktree 分支到目标分支
   */
  private async mergeWorktree(item?: WorktreeTreeItem): Promise<void> {
    let branchName: string;

    if (item?.worktreeInfo) {
      branchName = item.worktreeInfo.branch;
    } else {
      const worktrees = await this.worktreeManager.listWorktrees();
      const rootDir = this.configManager.getRootDir();

      const items = worktrees
        .filter((wt) => wt.rootPath !== rootDir)
        .map((wt) => ({
          label: `$(git-branch) ${wt.branch}`,
          description: `${wt.projects.filter((p) => p.exists).length}/${wt.projects.length} 个项目`,
          detail: `$(folder) ${wt.rootPath}`,
          branch: wt.branch,
        }));

      if (items.length === 0) {
        vscode.window.showInformationMessage('没有可合并的工作树');
        return;
      }

      const selected = await vscode.window.showQuickPick(items, {
        title: '合并工作树分支',
        placeHolder: '选择要合并的工作树分支',
      });

      if (!selected) {
        return;
      }

      branchName = selected.branch;
    }

    // 列出所有分支供选择
    const allBranches = await this.repoManager.getAllBranches();
    const repos = this.repoManager.getRepositories();
    const currentBranches = new Set(repos.map((r) => r.branch));
    const branchCounts = new Map<string, number>();
    repos.forEach((r) => {
      branchCounts.set(r.branch, (branchCounts.get(r.branch) || 0) + 1);
    });

    const branchItems = allBranches
      .filter((b) => b !== branchName)
      .map((b) => {
        const count = branchCounts.get(b);
        return {
          label: currentBranches.has(b) ? `$(check) ${b}` : `$(git-branch) ${b}`,
          description: count ? `当前 ${count}/${repos.length} 个项目` : '',
          branch: b,
        };
      });

    const selectedTarget = await vscode.window.showQuickPick(branchItems, {
      title: '合并目标分支',
      placeHolder: '选择要合并到的目标分支',
    });

    if (!selectedTarget) {
      return;
    }

    const targetBranch = selectedTarget.branch;

    // 确认
    const confirm = await vscode.window.showWarningMessage(
      `确定要将 "${branchName}" 合并到 "${targetBranch}" 吗？\n\n此操作会在每个项目的主仓库中执行 git merge。`,
      { modal: true },
      '确定合并'
    );

    if (confirm !== '确定合并') {
      return;
    }

    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在合并 ${branchName} → ${targetBranch}`,
        cancellable: false,
      },
      async (progress) => {
        logger.show();
        this.statusBarProvider.showBusy('正在合并...');

        const result = await this.worktreeManager.mergeWorktreeAll(
          branchName,
          targetBranch,
          (current, total, name) => {
            progress.report({
              message: `${name} (${current}/${total})`,
              increment: (1 / total) * 100,
            });
          }
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.showBatchResult('合并', result, elapsed);
        // 输出每个项目的合并日志
        result.results.forEach((r) => {
          const tag = r.success ? 'success' : 'error';
          const prefix = r.success ? '✓' : '✗';
          logger.info(`${prefix} [${logger.colorize(r.projectName, 'cyan')}] ${r.message}`, tag);
        });

        // 检查冲突
        const conflicts = result.results.filter((r) => !r.success && r.message.includes('冲突'));
        if (conflicts.length > 0) {
          vscode.window.showWarningMessage(
            `${conflicts.length} 个项目存在合并冲突，请手动解决: ${conflicts.map((c) => c.projectName).join(', ')}`
          );
        }

        this.statusBarProvider.update();
        this.projectTreeProvider.refresh();
      }
    );
  }

  /**
   * 打开 worktree（始终在新窗口打开）
   */
  private async openWorktree(item?: WorktreeTreeItem): Promise<void> {
    if (item?.worktreeInfo) {
      // 从 inline 按钮点击 → 直接打开
      await this.worktreeManager.openWorktree(item.worktreeInfo.branch, true);
      return;
    }

    // 从命令面板触发 → 显示选择列表
    const worktrees = await this.worktreeManager.listWorktrees();

    const items = worktrees.map((wt) => {
      const existingCount = wt.projects.filter((p) => p.exists).length;
      return {
        label: `$(git-branch) ${wt.branch}`,
        description: `${existingCount}/${wt.projects.length} 个项目`,
        detail: `$(folder) ${wt.rootPath}`,
        branch: wt.branch,
      };
    });

    if (items.length === 0) {
      vscode.window.showInformationMessage('没有可打开的工作树');
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: '打开工作树（新窗口）',
      placeHolder: '选择要打开的工作树',
    });

    if (!selected) {
      return;
    }

    await this.worktreeManager.openWorktree(selected.branch, true);
  }

  /**
   * 克隆项目
   */
  private async cloneProject(): Promise<void> {
    const svnUrl = await vscode.window.showInputBox({
      prompt: '输入 SVN URL',
      placeHolder: 'svn://svn.example.com/repos/project/trunk/module',
    });

    if (!svnUrl) {
      return;
    }

    // 从 URL 提取项目名
    const defaultName = svnUrl.split('/').pop() || 'project';

    const projectName = await vscode.window.showInputBox({
      prompt: '输入项目名称',
      value: defaultName,
    });

    if (!projectName) {
      return;
    }

    const revision = await vscode.window.showInputBox({
      prompt: '输入版本号（可选，留空表示 HEAD）',
      placeHolder: 'HEAD',
    });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在克隆 ${projectName}`,
        cancellable: false,
      },
      async () => {
        logger.show();
        const result = await this.repoManager.cloneProject(
          svnUrl,
          projectName,
          revision || 'HEAD'
        );

        if (result.success) {
          vscode.window.showInformationMessage(`项目 ${projectName} 克隆成功`);
          await this.maybeAutoScanClonedProjects([projectName]);
        } else {
          vscode.window.showErrorMessage(`克隆失败: ${result.message}`);
        }
      }
    );
  }

  /**
   * 批量克隆所有项目
   */
  private async cloneAllProjects(): Promise<void> {
    const config = this.configManager.getConfig();
    if (!config) {
      vscode.window.showErrorMessage('未找到配置文件。请先运行"初始化配置"。');
      return;
    }

    const projects = this.configManager.getProjects();
    const projectsWithSvnRemotes = projects.filter((p) => p.svnRemotes && Object.keys(p.svnRemotes).length > 0);

    if (projectsWithSvnRemotes.length === 0) {
      vscode.window.showErrorMessage(
        '没有配置 svnRemotes 的项目。请在 .mgitsvn.json 中为项目添加 svnRemotes'
      );
      return;
    }

    // 确认操作
    const confirm = await vscode.window.showInformationMessage(
      `从 SVN 克隆 ${projectsWithSvnRemotes.length} 个项目？这可能需要一段时间。`,
      { modal: true },
      '确定'
    );

    if (confirm !== '确定') {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MGitSVN: 正在克隆所有项目',
        cancellable: false,
      },
      async (progress) => {
        logger.show();
        this.statusBarProvider.showBusy('正在克隆...');

        const result = await this.repoManager.cloneAllProjects((current, total, name) => {
          progress.report({
            message: `${name} (${current}/${total})`,
            increment: (1 / total) * 100,
          });
        });

        this.showBatchResult('克隆', result);
        this.statusBarProvider.update();
        const succeededProjects = result.results.filter((item) => item.success).map((item) => item.projectName);
        await this.maybeAutoScanClonedProjects(succeededProjects);
      }
    );
  }

  /**
   * 刷新
   */
  private async refresh(): Promise<void> {
    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MGitSVN: 正在刷新...',
        cancellable: false,
      },
      async () => {
        await this.repoManager.refreshRepositories();
        await this.worktreeTreeProvider.loadWorktrees();
        this.projectTreeProvider.refresh();
        this.statusBarProvider.update();
      }
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    vscode.window.setStatusBarMessage(`$(check) MGitSVN: 刷新完成 (${elapsed}s)`, 3000);
  }

  /**
   * 初始化配置
   */
  private async initConfig(): Promise<void> {
    // 检查是否有工作区
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      const action = await vscode.window.showErrorMessage(
        '请先打开一个文件夹，然后再初始化 MGitSVN 配置。',
        '打开文件夹'
      );
      if (action === '打开文件夹') {
        await vscode.commands.executeCommand('vscode.openFolder');
      }
      return;
    }

    // 默认使用当前工作区根目录
    const defaultRootDir = workspaceFolders[0].uri.fsPath;

    const rootDir = await vscode.window.showInputBox({
      prompt: '输入项目根目录',
      value: defaultRootDir,
      valueSelection: [defaultRootDir.length, defaultRootDir.length], // 光标置于末尾
    });

    if (!rootDir) {
      return;
    }

    const success = await this.configManager.createInitialConfig(rootDir);

    if (success) {
      vscode.window.showInformationMessage('配置创建成功');
      await this.refresh();
    } else {
      vscode.window.showErrorMessage('配置创建失败');
    }
  }

  /**
   * 单个项目 rebase
   */
  private async rebaseProject(item: ProjectTreeItem): Promise<void> {
    const projectName = item.repository.name;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在更新 ${projectName}`,
        cancellable: false,
      },
      async () => {
        logger.show();
        const result = await this.repoManager.rebaseProject(projectName);

        if (result.success) {
          // 使用状态栏消息，3秒后自动消失
          vscode.window.setStatusBarMessage(`$(check) MGitSVN: ${projectName} 更新成功`, 3000);
          this.logOperationResult(result);
        } else {
          vscode.window.showErrorMessage(`更新 ${projectName} 失败: ${result.message}`);
        }

        this.statusBarProvider.update();
        this.projectTreeProvider.refresh();
      }
    );
  }

  /**
   * 单个项目 dcommit
   */
  private async dcommitProject(item: ProjectTreeItem): Promise<void> {
    const projectName = item.repository.name;

    // 确认操作
    const confirm = await vscode.window.showWarningMessage(
      `确定要将 ${projectName} 提交到 SVN 吗？`,
      { modal: true },
      '确定'
    );

    if (confirm !== '确定') {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在提交 ${projectName}`,
        cancellable: false,
      },
      async () => {
        logger.show();
        const result = await this.repoManager.dcommitProject(projectName);

        if (result.success) {
          // 使用状态栏消息，3秒后自动消失
          vscode.window.setStatusBarMessage(`$(check) MGitSVN: ${projectName} 提交成功`, 3000);
        } else {
          vscode.window.showErrorMessage(`提交 ${projectName} 失败: ${result.message}`);
        }

        this.statusBarProvider.update();
        this.projectTreeProvider.refresh();
      }
    );
  }

  /**
   * 显示批量操作结果
   */
  private showBatchResult(operation: string, result: BatchResult, elapsed?: string): void {
    if (!this.configManager.isShowNotifications()) {
      return;
    }

    const timeInfo = elapsed ? ` (${elapsed}s)` : '';
    const message = `${operation}: ${result.successCount} 个成功, ${result.failureCount} 个失败${timeInfo}`;

    if (result.failureCount > 0) {
      const failedProjects = result.results
        .filter((r) => !r.success)
        .map((r) => `${r.projectName}: ${r.message}`)
        .join('\n');

      vscode.window
        .showWarningMessage(`${message}。失败: ${failedProjects}`, '查看日志')
        .then((action) => {
          if (action === '查看日志') {
            logger.show();
          }
        });
    } else {
      // 成功时使用状态栏消息，5秒后自动消失
      vscode.window.setStatusBarMessage(`$(check) MGitSVN: ${message}`, 5000);
    }
  }

  /**
   * 切换 SVN Remote（trunk/branch）
   */
  private async switchSvnRemote(): Promise<void> {
    // 获取可用的 SVN remote 名称
    const availableRemotes = this.repoManager.getAvailableSvnRemoteNames();

    if (availableRemotes.length === 0) {
      vscode.window.showErrorMessage(
        '未配置 SVN remote。请在 .mgitsvn.json 配置文件中添加 svnRemotes。'
      );
      return;
    }

    // 让用户选择 remote 类型
    const items = availableRemotes.map((name) => ({
      label: name === 'trunk' ? '$(git-merge) trunk' : `$(git-branch) ${name}`,
      description: name === 'trunk' ? '切换到 trunk（稳定版）' : '切换到分支',
      remoteName: name,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: '切换 SVN 源',
      placeHolder: '选择 SVN 源类型（trunk 或 branch）',
    });

    if (!selected) {
      return;
    }

    let branchName: string | undefined;

    // 如果选择的是 branch，且模板包含 {branch}，需要输入分支名
    const projects = this.configManager.getProjects();
    const needsBranchName = projects.some((p) => {
      const url = p.svnRemotes?.[selected.remoteName];
      return url && url.includes('{branch}');
    });

    if (needsBranchName) {
      branchName = await vscode.window.showInputBox({
        prompt: '输入分支名称',
        placeHolder: '例如：branch_2.2.0_20251204',
        validateInput: (value) => {
          if (!value || value.trim() === '') {
            return '分支名称不能为空';
          }
          return null;
        },
      });

      if (!branchName) {
        return;
      }
    }

    const startTime = Date.now();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在切换到 ${selected.remoteName}${branchName ? ` (${branchName})` : ''}`,
        cancellable: true,
      },
      async (progress, token) => {
        logger.show();
        this.statusBarProvider.showBusy('正在切换 SVN 源...');

        const result = await this.repoManager.switchSvnRemoteAll(
          selected.remoteName,
          branchName,
          (current, total, name) => {
            if (token.isCancellationRequested) {
              return;
            }
            progress.report({
              message: `${name} (${current}/${total})`,
              increment: (1 / total) * 100,
            });
          }
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.showBatchResult('切换 SVN 源', result, elapsed);
        this.projectTreeProvider.refresh();
        this.statusBarProvider.update();
      }
    );
  }

  /**
   * 记录详细的操作结果日志
   */
  private logOperationResult(result: OperationResult): void {
    if (!result.success) {
      return;
    }

    const projectName = logger.colorize(result.projectName, 'cyan');
    const repo = this.repoManager.getRepository(result.projectName);
    const basePath = repo ? repo.path : '';

    if (result.changes && result.changes.length > 0) {
      logger.info(`\n>> [${projectName}] 变更详情 (${logger.colorize(result.changes.length.toString(), 'success')} 个文件):`);

      // 按状态排序：A -> M -> D
      const sortedChanges = [...result.changes].sort((a, b) => {
        const order: Record<string, number> = { 'A': 0, 'M': 1, 'D': 2 };
        return (order[a.status] ?? 99) - (order[b.status] ?? 99);
      });

      sortedChanges.forEach(change => {
        let statusText = change.status;
        let color: any = 'info';
        if (change.status === 'A') {
          statusText = 'ADDED   ';
          color = 'success';
        } else if (change.status === 'M') {
          statusText = 'MODIFIED';
          color = 'warn';
        } else if (change.status === 'D') {
          statusText = 'DELETED ';
          color = 'error';
        }

        // 构造绝对路径链接
        const absPath = path.isAbsolute(change.path) ? change.path : path.join(basePath, change.path);
        const fileLink = `file://${absPath}`;

        logger.info(`   ${logger.colorize(statusText, color)}  ${fileLink}`);
      });
      logger.info(`>> [${projectName}] ${logger.colorize('更新完成', 'success')}\n`);

      // 自动显示日志
      logger.show();
    } else {
      logger.info(`>> [${projectName}] 已是最新，无变更。`);
    }
  }

  /**
   * 在终端中打开项目目录
   * 支持主项目和工作树项目
   */
  private async openInTerminal(item: ProjectTreeItem | WorktreeTreeItem): Promise<void> {
    let cwd: string | undefined;
    let name: string;

    if (item instanceof ProjectTreeItem) {
      cwd = item.repository.path;
      name = item.repository.name;
    } else if (item instanceof WorktreeTreeItem) {
      if (item.projectPath) {
        // 工作树下的项目
        cwd = item.projectPath;
        name = item.label as string;
      } else if (item.worktreeInfo) {
        // 工作树根节点
        cwd = item.worktreeInfo.rootPath;
        name = item.worktreeInfo.branch;
      } else {
        return;
      }
    } else {
      return;
    }

    if (!cwd) {
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: `MGitSVN: ${name}`,
      cwd,
    });
    terminal.show();
  }

  /**
   * 打开工作树项目文件夹
   */
  private async openWorktreeFolder(item: WorktreeTreeItem): Promise<void> {
    if (item.projectPath) {
      const uri = vscode.Uri.file(item.projectPath);
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    }
  }

  /**
   * 打开配置文件
   */
  private async openConfig(): Promise<void> {
    const configPath = this.configManager.getConfigFilePath();
    if (configPath) {
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc);
    } else {
      vscode.window.showInformationMessage('未找到配置文件，是否要初始化？', '初始化').then((action) => {
        if (action === '初始化') {
          vscode.commands.executeCommand('mgitsvn.initConfig');
        }
      });
    }
  }

  /**
   * 打开使用文档
   */
  private async openDocumentation(): Promise<void> {
    const extension =
      vscode.extensions.getExtension('realguan.mgitsvn') ??
      vscode.extensions.all.find(
        (item) => item.packageJSON?.publisher === 'realguan' && item.packageJSON?.name === 'mgitsvn'
      );

    const publisher = extension?.packageJSON?.publisher ?? 'realguan';
    const name = extension?.packageJSON?.name ?? 'mgitsvn';
    const extensionId = buildExtensionId(publisher, name);

    try {
      await vscode.commands.executeCommand('extension.open', extensionId);
      return;
    } catch {
      const url = buildMarketplaceItemUrl(publisher, name);
      const opened = await vscode.env.openExternal(vscode.Uri.parse(url));

      if (!opened) {
        vscode.window.showErrorMessage(`打开插件文档失败：${url}`);
      }
    }
  }

  /**
   * 扫描全部 externals
   */
  private async scanExternals(): Promise<void> {
    const repositories = this.repoManager
      .getRepositories()
      .filter((repo) => repo.isGitSvn && repo.svnUrl);

    if (repositories.length === 0) {
      vscode.window.showInformationMessage('没有可扫描 externals 的 git-svn 项目');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MGitSVN: 正在扫描 SVN externals',
        cancellable: false,
      },
      async (progress) => {
        const results: SvnExternalsScanResult[] = [];
        let current = 0;

        for (const repository of repositories) {
          current++;
          progress.report({
            message: `${repository.name} (${current}/${repositories.length})`,
            increment: (1 / repositories.length) * 100,
          });

          const result = await this.externalsService.scanProject({
            ownerProject: repository.name,
            ownerProjectPath: path.relative(this.configManager.getRootDir(), repository.path) || repository.name,
            scannedUrl: repository.svnUrl!,
            cwd: repository.path,
          });
          results.push(result);
        }

        await this.showExternalsSummary(results, false);
      }
    );
  }

  /**
   * 扫描单个项目 externals
   */
  private async scanProjectExternals(item?: ProjectTreeItem): Promise<void> {
    if (!(item instanceof ProjectTreeItem)) {
      await this.scanExternals();
      return;
    }

    const repository = item.repository;
    if (!repository.isGitSvn || !repository.svnUrl) {
      vscode.window.showInformationMessage(`项目 ${repository.name} 不是可扫描的 git-svn 仓库`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在扫描 ${repository.name} 的 SVN externals`,
        cancellable: false,
      },
      async () => {
        const result = await this.externalsService.scanProject({
          ownerProject: repository.name,
          ownerProjectPath: path.relative(this.configManager.getRootDir(), repository.path) || repository.name,
          scannedUrl: repository.svnUrl!,
          cwd: repository.path,
        });

        await this.showExternalsSummary([result], false);
      }
    );
  }

  /**
   * 将单个项目的目录 external 导入到配置
   */
  private async importProjectExternals(item?: ProjectTreeItem): Promise<void> {
    if (!(item instanceof ProjectTreeItem)) {
      vscode.window.showInformationMessage('请从项目节点上执行“导入项目 Externals”');
      return;
    }

    const repository = item.repository;
    if (!repository.isGitSvn || !repository.svnUrl) {
      vscode.window.showInformationMessage(`项目 ${repository.name} 不是可导入 externals 的 git-svn 仓库`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在导入 ${repository.name} 的目录 externals`,
        cancellable: false,
      },
      async () => {
        const result = await this.scanRepositoryExternals(repository);

        if (result.directoryExternals.length === 0) {
          vscode.window.showInformationMessage(`项目 ${repository.name} 未发现可导入的目录 external`);
          return;
        }
        await this.importDirectoryExternalsFromResults(
          [result],
          `导入 ${repository.name} 的目录 externals`
        );
      }
    );
  }

  /**
   * 应用单个项目的 file externals
   */
  private async applyProjectFileExternals(item?: ProjectTreeItem): Promise<void> {
    if (!(item instanceof ProjectTreeItem)) {
      vscode.window.showInformationMessage('请从项目节点上执行“应用 File Externals”');
      return;
    }

    const repository = item.repository;
    if (!repository.isGitSvn || !repository.svnUrl) {
      vscode.window.showInformationMessage(`项目 ${repository.name} 不是可应用 file externals 的 git-svn 仓库`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MGitSVN: 正在应用 ${repository.name} 的 file externals`,
        cancellable: false,
      },
      async () => {
        const result = await this.scanRepositoryExternals(repository);

        if (result.fileExternals.length === 0) {
          vscode.window.showInformationMessage(`项目 ${repository.name} 未发现可应用的 file external`);
          return;
        }
        await this.applyFileExternalsFromResults(
          [result],
          `应用 ${repository.name} 的 file externals`
        );
      }
    );
  }

  /**
   * 重放当前工作区中所有已保存的 file external 规则
   */
  private async reapplyFileExternals(): Promise<void> {
    const config = this.configManager.getConfig();
    const rules = config?.externals?.fileRules?.filter((rule) => rule.enabled) ?? [];

    if (rules.length === 0) {
      vscode.window.showInformationMessage('当前没有可重放的 file external 规则');
      return;
    }

    const rootDir = this.configManager.getRootDir();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MGitSVN: 正在重放 File Externals',
        cancellable: false,
      },
      async () => {
        const plan = FileExternalRuleHelper.buildWorkspaceApplicationPlan(rootDir, rules);

        for (const item of plan) {
          await this.fileExternalLinkManager.applyRules(item.projectRootPath, item.rules);
          await this.excludeRuleManager.ensureRules(
            item.projectRootPath,
            item.rules.map((rule) => rule.localRelativePath)
          );
        }

        vscode.window.showInformationMessage(`已重放 ${rules.length} 条 file external 规则`);
      }
    );
  }

  /**
   * 管理 SVN 凭据
   */
  private async manageSvnCredential(): Promise<void> {
    const svnUrl = await vscode.window.showInputBox({
      prompt: '输入 SVN URL（用于确定凭据作用域）',
      placeHolder: 'https://svn.example.com/repos/project/trunk',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'SVN URL 不能为空';
        }
        return null;
      },
    });

    if (!svnUrl) {
      return;
    }

    const credential = await this.commandRunner.ensureCredential(svnUrl);
    if (!credential) {
      return;
    }

    const result = await this.commandRunner.runSvnCommand(['info', svnUrl], {
      cwd: this.configManager.getRootDir() || process.cwd(),
      authUrl: svnUrl,
      executionMode: 'background',
      repoLabel: 'credential-bootstrap',
      terminalTitle: 'MGitSVN Manage Credential',
    });

    if (result.success) {
      vscode.window.showInformationMessage('SVN 凭据已保存并完成认证预热');
      return;
    }

    vscode.window.showWarningMessage(`凭据保存已触发，但认证预热失败：${result.message}`, '查看日志').then((action) => {
      if (action === '查看日志') {
        logger.show();
      }
    });
  }

  /**
   * 清除 SVN 凭据
   */
  private async clearSvnCredential(): Promise<void> {
    const svnUrl = await vscode.window.showInputBox({
      prompt: '输入需要清除的 SVN URL',
      placeHolder: 'https://svn.example.com/repos/project/trunk',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'SVN URL 不能为空';
        }
        return null;
      },
    });

    if (!svnUrl) {
      return;
    }

    await this.credentialService.deleteCredential(svnUrl);
    vscode.window.showInformationMessage('SVN 凭据已清除');
  }

  /**
   * clone 成功后按配置自动扫描 externals
   */
  private async maybeAutoScanClonedProjects(projectNames: string[]): Promise<void> {
    if (!this.configManager.shouldAutoScanExternalsAfterClone() || projectNames.length === 0) {
      return;
    }

    const results: SvnExternalsScanResult[] = [];
    for (const projectName of projectNames) {
      const repository = this.repoManager.getRepository(projectName);
      if (!repository?.svnUrl || !repository.isGitSvn) {
        continue;
      }

      const result = await this.scanRepositoryExternals(repository);
      results.push(result);
    }

    await this.showExternalsSummary(results, true);
  }

  /**
   * 展示 externals 摘要
   */
  private async showExternalsSummary(
    results: SvnExternalsScanResult[],
    silentIfEmpty: boolean
  ): Promise<void> {
    const initialSummary = ExternalsSummaryHelper.summarize(results);
    const autoPlan = ExternalsAutoManageStrategy.buildPlan({
      directoryMode: this.configManager.getDirectoryExternalMode(),
      fileMode: this.configManager.getFileExternalMode(),
      directoryCount: initialSummary.directoryCount,
      fileCount: initialSummary.fileCount,
    });

    let autoImportedCount = 0;
    let autoAppliedCount = 0;

    if (autoPlan.autoImportDirectories) {
      autoImportedCount = await this.importDirectoryExternalsFromResults(
        results,
        '自动导入目录 externals',
        { autoSelectAll: true, suppressSuccessMessage: true }
      );
    }

    if (autoPlan.autoApplyFiles) {
      autoAppliedCount = await this.applyFileExternalsFromResults(
        results,
        '自动应用 file externals',
        { autoSelectAll: true, suppressSuccessMessage: true }
      );
    }

    const promptableResults = results.map((result) => ({
      ...result,
      directoryExternals: autoPlan.shouldPromptDirectories ? result.directoryExternals : [],
      fileExternals: autoPlan.shouldPromptFiles ? result.fileExternals : [],
    }));

    const summary = ExternalsSummaryHelper.summarize(promptableResults);

    if (!summary.hasAny) {
      if (autoImportedCount > 0 || autoAppliedCount > 0) {
        vscode.window.showInformationMessage(
          `已自动处理 SVN externals：导入目录 ${autoImportedCount} 个，应用文件 ${autoAppliedCount} 个。`
        );
        return;
      }
      if (!silentIfEmpty) {
        vscode.window.showInformationMessage('未发现 SVN externals');
      }
      return;
    }

    for (const result of results) {
      if (
        result.directoryExternals.length === 0 &&
        result.fileExternals.length === 0 &&
        result.unknownExternals.length === 0
      ) {
        continue;
      }

      logger.info(`SVN externals scan result for ${result.ownerProject}:`);
      result.directoryExternals.forEach((item) => {
        logger.info(`[directory] ${item.localRelativePath} <- ${item.externalUrl}`);
      });
      result.fileExternals.forEach((item) => {
        logger.info(`[file] ${item.localRelativePath} <- ${item.externalUrl}`);
      });
      result.unknownExternals.forEach((item) => {
        logger.warn(`[unknown] ${item.localRelativePath} <- ${item.externalUrl}`);
      });
    }

    logger.show();
    const actions: string[] = [];
    if (summary.hasDirectoryActions && summary.hasFileActions) {
      actions.push('全部应用');
    }
    if (summary.hasDirectoryActions) {
      actions.push('导入目录 Externals');
    }
    if (summary.hasFileActions) {
      actions.push('应用 File Externals');
    }
    actions.push('查看日志');

    const autoSuffix =
      autoImportedCount > 0 || autoAppliedCount > 0
        ? ` 已自动处理：目录 ${autoImportedCount} 个，文件 ${autoAppliedCount} 个。`
        : '';

    const action = await vscode.window.showInformationMessage(
      `发现 SVN externals：目录 ${summary.directoryCount} 个，文件 ${summary.fileCount} 个，未知 ${summary.unknownCount} 个。${autoSuffix}`,
      ...actions
    );

    if (action === '查看日志') {
      logger.show();
      return;
    }

    if (action === '全部应用') {
      await this.importDirectoryExternalsFromResults(results, '导入目录 externals');
      await this.applyFileExternalsFromResults(results, '应用 file externals');
      return;
    }

    if (action === '导入目录 Externals') {
      await this.importDirectoryExternalsFromResults(results, '导入目录 externals');
      return;
    }

    if (action === '应用 File Externals') {
      await this.applyFileExternalsFromResults(results, '应用 file externals');
    }
  }

  private async scanRepositoryExternals(repository: {
    name: string;
    path: string;
    svnUrl?: string;
  }): Promise<SvnExternalsScanResult> {
    return this.externalsService.scanProject({
      ownerProject: repository.name,
      ownerProjectPath: path.relative(this.configManager.getRootDir(), repository.path) || repository.name,
      scannedUrl: repository.svnUrl!,
      cwd: repository.path,
    });
  }

  private async importDirectoryExternalsFromResults(
    results: SvnExternalsScanResult[],
    title: string,
    options?: {
      autoSelectAll?: boolean;
      suppressSuccessMessage?: boolean;
    }
  ): Promise<number> {
    const definitions = results.flatMap((result) => result.directoryExternals);
    if (definitions.length === 0) {
      vscode.window.showInformationMessage('未发现可导入的目录 external');
      return 0;
    }

    const items = definitions.map((definition) => ({
      label: `${definition.ownerProject}: ${definition.localRelativePath}`,
      description: definition.externalUrl,
      definition,
      picked: true,
    }));

    const selected = options?.autoSelectAll
      ? items
      : await vscode.window.showQuickPick(items, {
          title,
          placeHolder: '选择要纳入 MGitSVN 管理的目录 external',
          canPickMany: true,
        });

    if (!selected || selected.length === 0) {
      return 0;
    }

    const config = this.configManager.getConfig();
    if (!config) {
      vscode.window.showErrorMessage('未找到配置文件。请先运行“初始化配置”。');
      return 0;
    }

    const existingByPath = new Set(config.projects.map((project) => project.path));
    const existingByName = new Set(config.projects.map((project) => project.name));
    const additions = selected
      .map((entry) => DirectoryExternalProjectManager.buildProjectConfig(entry.definition))
      .filter((project) => !existingByPath.has(project.path) && !existingByName.has(project.name));

    if (additions.length === 0) {
      if (!options?.suppressSuccessMessage) {
        vscode.window.showInformationMessage('所选目录 external 已经全部在配置中');
      }
      return 0;
    }

    const nextConfig = {
      ...config,
      projects: [...config.projects, ...additions],
    };

    const saved = await this.configManager.saveConfig(nextConfig);
    if (!saved) {
      vscode.window.showErrorMessage('写入 external 项目配置失败');
      return 0;
    }

    const repositoryByProject = new Map(
      this.repoManager.getRepositories().map((repository) => [repository.name, repository])
    );

    const selectedByOwner = new Map<string, typeof selected>();
    for (const entry of selected) {
      const group = selectedByOwner.get(entry.definition.ownerProject) ?? [];
      group.push(entry);
      selectedByOwner.set(entry.definition.ownerProject, group);
    }

    for (const [ownerProject, entries] of selectedByOwner.entries()) {
      const repository = repositoryByProject.get(ownerProject);
      if (!repository) {
        continue;
      }

      await this.excludeRuleManager.ensureRules(
        repository.path,
        entries.map((entry) => entry.definition.localRelativePath)
      );
    }

    await this.repoManager.refreshRepositories();
    this.projectTreeProvider.refresh();
    this.statusBarProvider.update();

    if (!options?.suppressSuccessMessage) {
      vscode.window.showInformationMessage(
        `已导入 ${additions.length} 个目录 external。后续可执行“克隆全部项目”完成代码拉取。`
      );
    }
    return additions.length;
  }

  private async applyFileExternalsFromResults(
    results: SvnExternalsScanResult[],
    title: string,
    options?: {
      autoSelectAll?: boolean;
      suppressSuccessMessage?: boolean;
    }
  ): Promise<number> {
    const definitions = results.flatMap((result) => result.fileExternals);
    if (definitions.length === 0) {
      vscode.window.showInformationMessage('未发现可应用的 file external');
      return 0;
    }

    const items = definitions.map((definition) => ({
      label: `${definition.ownerProject}: ${definition.localRelativePath}`,
      description: definition.externalUrl,
      definition,
      picked: true,
    }));

    const selected = options?.autoSelectAll
      ? items
      : await vscode.window.showQuickPick(items, {
          title,
          placeHolder: '选择要落地到项目中的 file external',
          canPickMany: true,
        });

    if (!selected || selected.length === 0) {
      return 0;
    }

    const config = this.configManager.getConfig();
    if (!config) {
      vscode.window.showErrorMessage('未找到配置文件。请先运行“初始化配置”。');
      return 0;
    }

    const linkMode = this.configManager.getDefaultFileExternalLinkMode();
    const newRules = selected.map((entry) =>
      FileExternalRuleHelper.buildRule(entry.definition, linkMode)
    );
    const mergedRules = FileExternalRuleHelper.mergeRules(
      config.externals?.fileRules ?? [],
      newRules
    );

    const nextConfig = {
      ...config,
      externals: {
        ...(config.externals ?? {}),
        defaultFileLinkMode: config.externals?.defaultFileLinkMode ?? linkMode,
        fileRules: mergedRules,
      },
    };

    const saved = await this.configManager.saveConfig(nextConfig);
    if (!saved) {
      vscode.window.showErrorMessage('写入 file external 规则失败');
      return 0;
    }

    const rulesByProjectPath = FileExternalRuleHelper.buildWorkspaceApplicationPlan(
      this.configManager.getRootDir(),
      newRules
    );

    for (const item of rulesByProjectPath) {
      await this.fileExternalLinkManager.applyRules(item.projectRootPath, item.rules);
      await this.excludeRuleManager.ensureRules(
        item.projectRootPath,
        item.rules.map((rule) => rule.localRelativePath)
      );
    }

    if (!options?.suppressSuccessMessage) {
      vscode.window.showInformationMessage(
        `已应用 ${selected.length} 个 file external（模式：${linkMode}）。`
      );
    }
    return selected.length;
  }
}
