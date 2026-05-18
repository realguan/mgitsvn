import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigurationManager } from './ConfigurationManager';
import { ExcludeRuleManager } from './ExcludeRuleManager';
import { FileExternalLinkManager } from './FileExternalLinkManager';
import { FileExternalRuleHelper } from './FileExternalRuleHelper';
import { GitSvnAdapter } from './GitSvnAdapter';
import { WorktreeInfo, WorktreeProject, BatchResult, OperationResult } from '../models';
import { logger } from '../utils/logger';

/**
 * Worktree 管理器
 * 批量创建/删除 worktree，管理 worktree 与分支的映射关系
 */
export class WorktreeManager {
  private static instance: WorktreeManager;
  private configManager: ConfigurationManager;
  private fileExternalLinkManager: FileExternalLinkManager;
  private excludeRuleManager: ExcludeRuleManager;
  private onWorktreesChangeEmitter = new vscode.EventEmitter<WorktreeInfo[]>();

  /** Worktree 变更事件 */
  public readonly onWorktreesChange = this.onWorktreesChangeEmitter.event;

  private constructor() {
    this.configManager = ConfigurationManager.getInstance();
    this.fileExternalLinkManager = new FileExternalLinkManager();
    this.excludeRuleManager = new ExcludeRuleManager();
  }

  static getInstance(): WorktreeManager {
    if (!WorktreeManager.instance) {
      WorktreeManager.instance = new WorktreeManager();
    }
    return WorktreeManager.instance;
  }

  /**
   * 获取 worktree 根路径
   */
  private getWorktreeRootPath(branch: string): string {
    const baseDir = this.configManager.getWorktreeBaseDir();
    const rootDirName = path.basename(this.configManager.getRootDir());
    // 替换分支名中的特殊字符
    const safeBranchName = branch.replace(/\//g, '_');
    return path.join(baseDir, `${rootDirName}_${safeBranchName}`);
  }

  /**
   * 列出所有 worktree
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const projects = this.configManager.getProjects();
    const rootDir = this.configManager.getRootDir();
    const baseDir = this.configManager.getWorktreeBaseDir();
    const rootDirName = path.basename(rootDir);

    // 收集所有分支的 worktree
    const worktreeMap = new Map<string, WorktreeInfo>();

    // 扫描 worktree 目录
    if (fs.existsSync(baseDir)) {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      const prefix = `${rootDirName}_`;

      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(prefix)) {
          continue;
        }

        // 从目录名提取分支名
        const branchName = entry.name.substring(prefix.length).replace(/_/g, '/');
        const worktreeRoot = path.join(baseDir, entry.name);

        // 检查每个项目是否存在
        const worktreeProjects: WorktreeProject[] = projects.map((p) => {
          const projectPath = path.join(worktreeRoot, p.path);
          return {
            name: p.name,
            path: projectPath,
            exists: fs.existsSync(projectPath),
          };
        });

        // 只有至少有一个项目存在才算有效 worktree
        if (worktreeProjects.some((p) => p.exists)) {
          worktreeMap.set(branchName, {
            branch: branchName,
            rootPath: worktreeRoot,
            projects: worktreeProjects,
          });
        }
      }
    }

    const worktrees = Array.from(worktreeMap.values());
    this.onWorktreesChangeEmitter.fire(worktrees);
    return worktrees;
  }

  /**
   * 批量创建 worktree
   */
  async createWorktreeAll(
    branch: string,
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const projects = this.configManager.getProjects();
    const rootDir = this.configManager.getRootDir();
    const worktreeRoot = this.getWorktreeRootPath(branch);

    // 创建 worktree 根目录
    if (!fs.existsSync(worktreeRoot)) {
      fs.mkdirSync(worktreeRoot, { recursive: true });
    }

    const results: OperationResult[] = [];
    const total = projects.length;
    let current = 0;

    for (const project of projects) {
      current++;
      progressCallback?.(current, total, project.name);

      const sourcePath = path.join(rootDir, project.path);
      const targetPath = path.join(worktreeRoot, project.path);

      // 检查源仓库是否存在
      if (!fs.existsSync(sourcePath)) {
        results.push({
          projectName: project.name,
          success: false,
          message: 'Source repository not found',
        });
        continue;
      }

      // 检查目标是否已存在
      if (fs.existsSync(targetPath)) {
        results.push({
          projectName: project.name,
          success: true,
          message: 'Worktree already exists',
        });
        continue;
      }

      const adapter = new GitSvnAdapter(sourcePath);
      const isGit = await adapter.isGitRepository();

      if (!isGit) {
        results.push({
          projectName: project.name,
          success: false,
          message: 'Not a git repository',
        });
        continue;
      }

      const success = await adapter.addWorktree(targetPath, branch, true);
      results.push({
        projectName: project.name,
        success,
        message: success ? 'Worktree created' : 'Failed to create worktree',
      });
    }

    // 复制配置到 worktree（rootDir 改为实际绝对路径）
    await this.copyConfigToWorktree(worktreeRoot);

    // 生成 workspace 文件
    await this.generateWorkspaceFile(branch, worktreeRoot);

    // 同步配置的文件/目录到 worktree
    await this.syncFilesToWorktree(worktreeRoot);

    // 重放已保存的 file external 规则到新 worktree
    await this.applyFileExternalRulesToWorktree(worktreeRoot);

    // 刷新 worktree 列表
    await this.listWorktrees();

    return this.aggregateResults(results);
  }

  /**
   * 批量删除 worktree
   */
  async removeWorktreeAll(
    branch: string,
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const projects = this.configManager.getProjects();
    const rootDir = this.configManager.getRootDir();
    const worktreeRoot = this.getWorktreeRootPath(branch);

    const results: OperationResult[] = [];
    const total = projects.length;
    let current = 0;

    for (const project of projects) {
      current++;
      progressCallback?.(current, total, project.name);

      const sourcePath = path.join(rootDir, project.path);
      const targetPath = path.join(worktreeRoot, project.path);

      if (!fs.existsSync(targetPath)) {
        results.push({
          projectName: project.name,
          success: true,
          message: 'Worktree does not exist',
        });
        continue;
      }

      const adapter = new GitSvnAdapter(sourcePath);

      // 移除 worktree
      let success = await adapter.removeWorktree(targetPath);

      if (success) {
        // 检查主仓库当前分支。如果主仓库当前就在这个分支上，
        // 则需要先切换到其他分支才能删除该分支。
        const currentBranch = await adapter.getCurrentBranch();
        if (currentBranch === branch) {
          const branches = await adapter.getBranches();
          const safeBranch = branches.includes('trunk') ? 'trunk' : (branches.includes('master') ? 'master' : branches.find(b => b !== branch));
          if (safeBranch) {
            await adapter.checkout(safeBranch);
          }
        }

        // 删除本地分支
        await adapter.deleteBranch(branch, true);

        // 清理 worktree
        await adapter.pruneWorktrees();
      }

      results.push({
        projectName: project.name,
        success,
        message: success ? 'Worktree removed' : 'Failed to remove worktree',
      });
    }

    // 删除 worktree 根目录（项目子目录已清理，剩余为同步文件等，可直接删除）
    try {
      if (fs.existsSync(worktreeRoot)) {
        fs.rmSync(worktreeRoot, { recursive: true, force: true });
        logger.info(`Worktree root removed: ${worktreeRoot}`);
      }
    } catch (error) {
      logger.warn('Failed to remove worktree root directory', error);
    }

    // 刷新 worktree 列表
    await this.listWorktrees();

    return this.aggregateResults(results);
  }

  /**
   * 将 worktree 分支合并到目标分支（在主仓库执行）
   */
  async mergeWorktreeAll(
    branch: string,
    targetBranch: string,
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const projects = this.configManager.getProjects();
    const rootDir = this.configManager.getRootDir();
    const results: OperationResult[] = [];
    const total = projects.length;
    let current = 0;

    for (const project of projects) {
      current++;
      progressCallback?.(current, total, project.name);

      const sourcePath = path.join(rootDir, project.path);

      if (!fs.existsSync(sourcePath)) {
        results.push({
          projectName: project.name,
          success: false,
          message: '仓库不存在',
        });
        continue;
      }

      const adapter = new GitSvnAdapter(sourcePath);

      // 检查源分支是否存在
      const branchExists = await adapter.branchExists(branch);
      if (!branchExists) {
        results.push({
          projectName: project.name,
          success: false,
          message: `分支 ${branch} 不存在`,
        });
        continue;
      }

      // 切换到目标分支
      const checkedOut = await adapter.checkout(targetBranch);
      if (!checkedOut) {
        results.push({
          projectName: project.name,
          success: false,
          message: `无法切换到 ${targetBranch}`,
        });
        continue;
      }

      // 合并
      const mergeResult = await adapter.mergeBranch(branch);
      results.push(mergeResult);
    }

    return this.aggregateResults(results);
  }

  /**
   * 将 .mgitsvn.json 复制到 worktree 根目录，rootDir 替换为实际绝对路径
   */
  private async copyConfigToWorktree(worktreeRoot: string): Promise<void> {
    const configPath = this.configManager.getConfigFilePath();
    if (!configPath || !fs.existsSync(configPath)) {
      return;
    }

    try {
      const rawConfig = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(rawConfig);

      // rootDir 改为 worktree 的实际路径
      config.rootDir = worktreeRoot;
      // worktreeBaseDir 改为 worktree 的父目录
      config.worktreeBaseDir = path.dirname(worktreeRoot);

      const targetPath = path.join(worktreeRoot, '.mgitsvn.json');
      fs.writeFileSync(targetPath, JSON.stringify(config, null, 2));
      logger.info(`Config copied to worktree: ${targetPath}`);
    } catch (error) {
      logger.error('Failed to copy config to worktree', error);
    }
  }

  /**
   * 生成 VS Code workspace 文件
   */
  private async generateWorkspaceFile(branch: string, worktreeRoot: string): Promise<void> {
    const projects = this.configManager.getProjects();
    const safeBranchName = branch.replace(/\//g, '_');
    const workspaceFile = path.join(worktreeRoot, `${safeBranchName}.code-workspace`);

    const workspace = {
      folders: projects.map((p) => ({
        name: p.name,
        path: p.path,
      })),
      settings: {
        'mgitsvn.worktreeBranch': branch,
      },
    };

    try {
      fs.writeFileSync(workspaceFile, JSON.stringify(workspace, null, 2));
      logger.info(`Workspace file created: ${workspaceFile}`);
    } catch (error) {
      logger.error('Failed to create workspace file', error);
    }
  }

  /**
   * 同步文件/目录到 worktree
   * 根据配置将指定的文件或目录复制或软链到 worktree 中
   */
  private async syncFilesToWorktree(worktreeRoot: string): Promise<void> {
    const config = this.configManager.getConfig();
    if (!config?.worktreeSync || config.worktreeSync.length === 0) {
      return;
    }

    const rootDir = this.configManager.getRootDir();
    logger.info(`Syncing ${config.worktreeSync.length} items to worktree...`);

    for (const syncItem of config.worktreeSync) {
      const sourcePath = path.join(rootDir, syncItem.source);
      const targetPath = path.join(worktreeRoot, syncItem.source);

      try {
        // 检查源是否存在
        if (!fs.existsSync(sourcePath)) {
          logger.warn(`Sync source not found: ${sourcePath}`);
          continue;
        }

        // 确保目标父目录存在
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // 检查目标是否已存在（使用 existsSync，它不会抛异常）
        // 注意：existsSync 对于损坏的软链接会返回 false，所以用 lstatSync 再检查
        let targetExists = false;
        try {
          fs.lstatSync(targetPath);
          targetExists = true;
        } catch (_e) {
          // 目标不存在
        }

        if (targetExists) {
          logger.info(`Sync target already exists, skipping: ${syncItem.source}`);
          continue;
        }

        // 执行同步
        if (syncItem.mode === 'symlink') {
          // 创建软链接
          fs.symlinkSync(sourcePath, targetPath);
          logger.info(`Symlink created: ${syncItem.source}`);
        } else {
          // 复制文件或目录
          const stat = fs.statSync(sourcePath);
          if (stat.isDirectory()) {
            fs.cpSync(sourcePath, targetPath, { recursive: true });
            logger.info(`Directory copied: ${syncItem.source}`);
          } else {
            fs.copyFileSync(sourcePath, targetPath);
            logger.info(`File copied: ${syncItem.source}`);
          }
        }
      } catch (error) {
        logger.error(`Failed to sync ${syncItem.source}:`, error);
      }
    }
  }

  /**
   * 将 file external 规则重放到 worktree
   */
  private async applyFileExternalRulesToWorktree(worktreeRoot: string): Promise<void> {
    const rules = this.configManager.getConfig()?.externals?.fileRules?.filter((rule) => rule.enabled) ?? [];
    if (rules.length === 0) {
      return;
    }

    logger.info(`Applying ${rules.length} file external rules to worktree ${worktreeRoot}`);
    await this.fileExternalLinkManager.applyRulesInWorkspace(worktreeRoot, rules);

    const grouped = FileExternalRuleHelper.buildWorkspaceApplicationPlan(worktreeRoot, rules);
    for (const item of grouped) {
      if (!fs.existsSync(item.projectRootPath)) {
        continue;
      }

      await this.excludeRuleManager.ensureRules(
        item.projectRootPath,
        item.rules.map((rule) => rule.localRelativePath)
      );
    }
  }

  /**
   * 打开 worktree 工作区
   * @param branch 分支名
   * @param newWindow 是否在新窗口打开，true=新窗口，false=当前窗口
   */
  async openWorktree(branch: string, newWindow: boolean = true): Promise<void> {
    const worktreeRoot = this.getWorktreeRootPath(branch);

    if (fs.existsSync(worktreeRoot)) {
      // 直接打开 worktree 根目录
      const targetUri = vscode.Uri.file(worktreeRoot);
      // forceNewWindow: true 表示新窗口，false 表示当前窗口
      await vscode.commands.executeCommand('vscode.openFolder', targetUri, { forceNewWindow: newWindow });
    } else {
      vscode.window.showErrorMessage(`未找到分支 '${branch}' 的工作树`);
    }
  }

  /**
   * 聚合结果
   */
  private aggregateResults(results: OperationResult[]): BatchResult {
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return {
      successCount,
      failureCount,
      results,
    };
  }

  dispose(): void {
    this.onWorktreesChangeEmitter.dispose();
  }
}
