import * as vscode from 'vscode';
import { ConfigurationManager, RepositoryManager, RuntimeContextService, WorktreeManager } from './services';
import { ProjectTreeProvider, WorktreeTreeProvider, StatusBarProvider } from './providers';
import { CommandHandler } from './commands';
import { logger } from './utils';
import { RepositoryState } from './models';

/**
 * 插件激活入口
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('MGitSVN Extension: Starting activation...');
  logger.info('MGitSVN extension is activating...');

  try {
    // 1. 先初始化核心服务实例
    RuntimeContextService.getInstance().initialize(context);
    const configManager = ConfigurationManager.getInstance();
    const repoManager = RepositoryManager.getInstance();
    const worktreeManager = WorktreeManager.getInstance();

    // 2. 创建 UI Providers
    const projectTreeProvider = new ProjectTreeProvider();
    const worktreeTreeProvider = new WorktreeTreeProvider();
    const statusBarProvider = new StatusBarProvider();

    // 3. 尽早注册命令，确保即使后续初始化失败，命令也是存在的
    const commandHandler = new CommandHandler(
      projectTreeProvider,
      worktreeTreeProvider,
      statusBarProvider
    );
    commandHandler.registerCommands(context);
    console.log('MGitSVN Extension: Commands registered');

    // 4. 注册 UI 视图
    const projectTreeView = vscode.window.createTreeView('mgitsvn.projects', {
      treeDataProvider: projectTreeProvider,
      showCollapseAll: true,
    });

    const worktreeTreeView = vscode.window.createTreeView('mgitsvn.worktrees', {
      treeDataProvider: worktreeTreeProvider,
      showCollapseAll: true,
    });

    // 5. 添加到订阅列表
    context.subscriptions.push(
      projectTreeView,
      worktreeTreeView,
      statusBarProvider,
      { dispose: () => configManager.dispose() },
      { dispose: () => repoManager.dispose() },
      { dispose: () => worktreeManager.dispose() },
      { dispose: () => projectTreeProvider.dispose() },
      { dispose: () => worktreeTreeProvider.dispose() },
      { dispose: () => logger.dispose() }
    );

    // 6. 执行业务初始化业务逻辑（这部分最容易报错）
    console.log('MGitSVN Extension: Initializing services...');
    const configLoaded = await configManager.initialize();

    if (!configLoaded) {
      // 配置未加载，设置 context 控制 welcomeView
      await vscode.commands.executeCommand('setContext', 'mgitsvn.configLoaded', false);
      // 检查是否启用欢迎消息
      const showWelcome = vscode.workspace.getConfiguration('mgitsvn').get<boolean>('showWelcomeMessage', true);
      if (showWelcome) {
        logger.info('No config found. Showing welcome message.');
        showWelcomeMessage();
      } else {
        logger.info('No config found. Welcome message disabled.');
      }
    } else {
      await vscode.commands.executeCommand('setContext', 'mgitsvn.configLoaded', true);
      console.log('MGitSVN Extension: Config loaded, initializing RepoManager...');
      await repoManager.initialize();
      statusBarProvider.update();
      await worktreeTreeProvider.loadWorktrees();

      // 设置 View badge 显示有变更的项目数
      const updateBadge = () => {
        const repos = repoManager.getRepositories();
        const problemCount = repos.filter(r => r.state !== RepositoryState.Clean).length;
        projectTreeView.badge = problemCount > 0
          ? { value: problemCount, tooltip: `${problemCount} 个项目有未提交的变更` }
          : undefined;
      };
      updateBadge();
      repoManager.onRepositoriesChange(() => updateBadge());
    }

    // 7. 监听配置变更
    configManager.onConfigChange(async () => {
      await repoManager.refreshRepositories();
      await worktreeTreeProvider.loadWorktrees();
      statusBarProvider.update();
    });

    logger.info('MGitSVN extension activated successfully');
    console.log('MGitSVN Extension: Activation complete');

  } catch (error: any) {
    // 捕获并显示启动错误
    const msg = `MGitSVN Activation Failed: ${error?.message || error}`;
    console.error(msg, error);
    logger.error(msg, error);
    vscode.window.showErrorMessage(msg);
  }
}

/**
 * 显示欢迎信息
 */
function showWelcomeMessage(): void {
  vscode.window
    .showInformationMessage(
      '欢迎使用 MGitSVN！是否要初始化配置？',
      '立即初始化',
      '不再提示'
    )
    .then((selection) => {
      if (selection === '立即初始化') {
        vscode.commands.executeCommand('mgitsvn.initConfig');
      } else if (selection === '不再提示') {
        // 禁用欢迎消息
        vscode.workspace.getConfiguration('mgitsvn').update('showWelcomeMessage', false, vscode.ConfigurationTarget.Global);
      }
    });
}

/**
 * 插件停用入口
 */
export function deactivate(): void {
  logger.info('MGitSVN extension deactivated');
}
