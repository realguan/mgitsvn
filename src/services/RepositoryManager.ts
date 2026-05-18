import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationManager } from './ConfigurationManager';
import { GitSvnAdapter } from './GitSvnAdapter';
import { Repository, RepositoryState, BatchResult, OperationResult } from '../models';
import { logger } from '../utils/logger';

/**
 * 仓库管理器
 * 管理多个 git-svn 仓库的生命周期，提供批量操作能力
 */
export class RepositoryManager {
  private static instance: RepositoryManager;
  private configManager: ConfigurationManager;
  private repositories: Map<string, Repository> = new Map();
  private onRepositoriesChangeEmitter = new vscode.EventEmitter<Repository[]>();

  /** 仓库变更事件 */
  public readonly onRepositoriesChange = this.onRepositoriesChangeEmitter.event;

  private constructor() {
    this.configManager = ConfigurationManager.getInstance();
  }

  static getInstance(): RepositoryManager {
    if (!RepositoryManager.instance) {
      RepositoryManager.instance = new RepositoryManager();
    }
    return RepositoryManager.instance;
  }

  /**
   * 初始化仓库管理器
   */
  async initialize(): Promise<void> {
    await this.refreshRepositories();
  }

  /**
   * 刷新所有仓库状态
   */
  async refreshRepositories(): Promise<Repository[]> {
    const projects = this.configManager.getProjects();
    const rootDir = this.configManager.getRootDir();

    this.repositories.clear();

    const repos = await Promise.all(
      projects.map(async (project) => {
        const projectPath = path.join(rootDir, project.path);

        // 检查项目目录是否存在
        const fs = await import('fs');
        if (!fs.existsSync(projectPath)) {
          logger.info(`Project directory not found, skipping: ${projectPath}`);
          return null;
        }

        const adapter = new GitSvnAdapter(projectPath);

        const isGit = await adapter.isGitRepository();
        if (!isGit) {
          return null;
        }

        const isGitSvn = await adapter.isGitSvnRepository();
        const status = await adapter.getStatus();
        const svnUrl = isGitSvn ? await adapter.getSvnUrl() : undefined;

        let state: RepositoryState;
        if (!status.isClean) {
          state = RepositoryState.Modified;
        } else {
          state = RepositoryState.Clean;
        }

        const repo: Repository = {
          name: project.name,
          path: projectPath,
          branch: status.branch,
          state,
          uncommittedChanges: status.modified + status.staged + status.untracked,
          isGitSvn,
          svnUrl: svnUrl,
        };

        return repo;
      })
    );

    const validRepos = repos.filter((r): r is Repository => r !== null);
    validRepos.forEach((repo) => {
      this.repositories.set(repo.name, repo);
    });

    this.onRepositoriesChangeEmitter.fire(validRepos);
    return validRepos;
  }

  /**
   * 获取所有仓库
   */
  getRepositories(): Repository[] {
    return Array.from(this.repositories.values());
  }

  /**
   * 获取单个仓库
   */
  getRepository(name: string): Repository | undefined {
    return this.repositories.get(name);
  }

  /**
   * 批量 rebase
   */
  async rebaseAll(
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const repos = this.getRepositories().filter((r) => r.isGitSvn);
    return this.executeBatchOperation(repos, 'rebase', progressCallback);
  }

  /**
   * 单个项目 rebase
   */
  async rebaseProject(name: string): Promise<OperationResult> {
    const repo = this.repositories.get(name);
    if (!repo) {
      return { projectName: name, success: false, message: 'Repository not found' };
    }

    const adapter = new GitSvnAdapter(repo.path);
    const result = await adapter.rebase();

    // 刷新仓库状态
    await this.refreshRepositories();

    return {
      projectName: name,
      success: result.success,
      message: result.message,
      changes: result.changes,
    };
  }

  /**
   * 批量 dcommit
   */
  async dcommitAll(
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const repos = this.getRepositories().filter((r) => r.isGitSvn);
    return this.executeBatchOperation(repos, 'dcommit', progressCallback);
  }

  /**
   * 单个项目 dcommit
   */
  async dcommitProject(name: string): Promise<OperationResult> {
    const repo = this.repositories.get(name);
    if (!repo) {
      return { projectName: name, success: false, message: 'Repository not found' };
    }

    const adapter = new GitSvnAdapter(repo.path);
    const result = await adapter.dcommit();

    // 刷新仓库状态
    await this.refreshRepositories();

    return {
      projectName: name,
      success: result.success,
      message: result.message,
    };
  }

  /**
   * 批量切换分支
   */
  async checkoutAll(
    branch: string,
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const repos = this.getRepositories();
    const results: OperationResult[] = [];
    const total = repos.length;
    let current = 0;

    const concurrency = this.configManager.getConcurrency();
    const chunks = this.chunkArray(repos, concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (repo) => {
          current++;
          progressCallback?.(current, total, repo.name);

          const adapter = new GitSvnAdapter(repo.path);
          const exists = await adapter.branchExists(branch);

          let success: boolean;
          if (exists) {
            success = await adapter.checkout(branch);
          } else {
            success = await adapter.checkoutNewBranch(branch);
          }

          return {
            projectName: repo.name,
            success,
            message: success ? `Switched to ${branch}` : `Failed to switch to ${branch}`,
          };
        })
      );
      results.push(...chunkResults);
    }

    // 刷新仓库状态
    await this.refreshRepositories();

    return this.aggregateResults(results);
  }

  /**
   * 获取所有分支（合并所有仓库的分支）
   */
  async getAllBranches(): Promise<string[]> {
    const repos = this.getRepositories();
    const branchSets = await Promise.all(
      repos.map(async (repo) => {
        const adapter = new GitSvnAdapter(repo.path);
        return adapter.getBranches();
      })
    );

    // 合并所有分支并去重
    const allBranches = new Set<string>();
    branchSets.forEach((branches) => {
      branches.forEach((b) => allBranches.add(b));
    });

    return Array.from(allBranches).sort();
  }

  /**
   * 克隆项目
   */
  async cloneProject(
    svnUrl: string,
    projectName: string,
    revision?: string
  ): Promise<OperationResult> {
    const rootDir = this.configManager.getRootDir();
    const targetPath = path.join(rootDir, projectName);

    // 默认使用 'svn' 作为手工克隆的 remote ID
    const remoteId = 'svn';
    const result = await GitSvnAdapter.clone(svnUrl, targetPath, remoteId, revision);

    if (result.success) {
      // 检查是否需要重命名 master
      const adapter = new GitSvnAdapter(targetPath);
      const branches = await adapter.getBranches();
      if (branches.includes('master')) {
        await adapter.renameBranch('master', remoteId);
      }
      // 添加到配置
      await this.configManager.addProject({
        name: projectName,
        path: projectName,
        svnRemotes: {
          "origin": svnUrl
        },
        enabled: true,
      });

      // 刷新仓库列表
      await this.refreshRepositories();
    }

    return {
      projectName,
      success: result.success,
      message: result.message,
    };
  }

  /**
   * 批量克隆配置文件中的所有项目
   */
  async cloneAllProjects(
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const projects = [...this.configManager.getProjects()].sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });
    const rootDir = this.configManager.getRootDir();
    const results: OperationResult[] = [];
    const total = projects.length;
    let current = 0;

    for (const project of projects) {
      current++;
      progressCallback?.(current, total, project.name);

      const targetPath = path.join(rootDir, project.path);

      // 检查目录是否已存在
      const fs = await import('fs');
      if (fs.existsSync(targetPath)) {
        // 检查是否已是 git 仓库
        const gitDir = path.join(targetPath, '.git');
        if (fs.existsSync(gitDir)) {
          results.push({
            projectName: project.name,
            success: true,
            message: 'Already exists, skipped',
          });
          continue;
        }
      }

      // 检查是否有 svn 远程配置
      const remoteNames = Object.keys(project.svnRemotes);
      if (remoteNames.length === 0) {
        results.push({
          projectName: project.name,
          success: false,
          message: 'No SVN remotes configured',
        });
        continue;
      }

      // 默认克隆第一个 remote (通常是 trunk 或某个 branch)
      // 注意：如果是模板 URL，这里可能需要特殊处理，但通常 Clone All 时配置里应该有明确的地址或默认地址
      let svnUrl = project.svnRemotes[remoteNames[0]];

      // 如果是模板地址，尝试移除占位符或报错
      if (svnUrl.includes('{branch}')) {
        results.push({
          projectName: project.name,
          success: false,
          message: 'Cannot clone from template URL. Please specify a concrete URL or use Switch SVN Remote.',
        });
        continue;
      }

      // 克隆项目（默认使用 -r HEAD 只拉取最新版本，避免拉取整个历史导致卡住）
      const primaryRemoteName = remoteNames[0];
      const result = await GitSvnAdapter.clone(svnUrl, targetPath, primaryRemoteName, 'HEAD');

      if (result.success) {
        // 重命名 master 分支为 primaryRemoteName，避免之后 switch 产生冲突
        const adapter = new GitSvnAdapter(targetPath);
        const branches = await adapter.getBranches();
        const localBranchName = primaryRemoteName === 'trunk' ? 'trunk' : primaryRemoteName;

        if (branches.includes('master') && localBranchName !== 'master') {
          await adapter.renameBranch('master', localBranchName);
        }
      }

      results.push({
        projectName: project.name,
        success: result.success,
        message: result.message,
      });
    }

    // 刷新仓库列表
    await this.refreshRepositories();

    return this.aggregateResults(results);
  }

  /**
   * 执行批量操作
   */
  private async executeBatchOperation(
    repos: Repository[],
    operation: 'rebase' | 'dcommit',
    progressCallback?: (current: number, total: number, name: string) => void
  ): Promise<BatchResult> {
    const results: OperationResult[] = [];
    const total = repos.length;
    let current = 0;

    const concurrency = this.configManager.getConcurrency();
    const chunks = this.chunkArray(repos, concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (repo) => {
          current++;
          progressCallback?.(current, total, repo.name);

          const adapter = new GitSvnAdapter(repo.path);
          const result =
            operation === 'rebase' ? await adapter.rebase() : await adapter.dcommit();

          logger.info(`${operation} ${repo.name}: ${result.success ? 'success' : 'failed'}`);

          return {
            projectName: repo.name,
            success: result.success,
            message: result.message,
            changes: (result as any).changes,
          };
        })
      );
      results.push(...chunkResults);
    }

    // 刷新仓库状态
    await this.refreshRepositories();

    return this.aggregateResults(results);
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

  /**
   * 分块数组
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 获取所有可用的 SVN Remote 模板
   * 从配置中收集所有项目的 svnRemotes key
   */
  getAvailableSvnRemoteNames(): string[] {
    const projects = this.configManager.getProjects();
    const remoteNames = new Set<string>();

    for (const project of projects) {
      if (project.svnRemotes) {
        Object.keys(project.svnRemotes).forEach(name => remoteNames.add(name));
      }
    }

    return Array.from(remoteNames);
  }

  /**
   * 批量切换所有项目到指定的 SVN Remote
   * @param remoteName remote 名称（如 'trunk' 或 'branch'）
   * @param branchName 分支名称（用于替换模板中的 {branch}）
   */
  async switchSvnRemoteAll(
    remoteName: string,
    branchName?: string,
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

      const projectPath = path.join(rootDir, project.path);

      // 检查目录是否存在
      const fs = await import('fs');
      if (!fs.existsSync(projectPath)) {
        results.push({
          projectName: project.name,
          success: false,
          message: 'Project directory not found',
        });
        continue;
      }

      // 获取该项目的 svnRemotes 配置
      const svnRemotes = project.svnRemotes || {};
      let svnUrl = svnRemotes[remoteName];

      if (!svnUrl) {
        // 如果没有配置该 remote，跳过
        results.push({
          projectName: project.name,
          success: false,
          message: `No SVN remote '${remoteName}' configured`,
        });
        continue;
      }

      // 替换模板中的 {branch} 占位符
      if (svnUrl.includes('{branch}') && branchName) {
        svnUrl = svnUrl.replace('{branch}', branchName);
      } else if (svnUrl.includes('{branch}') && !branchName) {
        results.push({
          projectName: project.name,
          success: false,
          message: 'Branch name required for template URL',
        });
        continue;
      }

      const adapter = new GitSvnAdapter(projectPath);

      // 生成本地分支名（trunk 或 具体的分支名）
      const localBranchName = remoteName === 'trunk' ? 'trunk' : (branchName || remoteName);

      // 检查本地分支是否已存在
      const branches = await adapter.getBranches();
      if (branches.includes(localBranchName)) {
        logger.info(`Branch ${localBranchName} already exists in ${project.name}, switching directly.`);
        const switchResult = await adapter.switchToSvnRemote(localBranchName);
        results.push({
          projectName: project.name,
          success: switchResult,
          message: switchResult ? `Switched to ${localBranchName}` : `Failed to switch to ${localBranchName}`,
        });
        continue;
      }

      // 1. 添加 SVN remote（如果不存在）
      const addResult = await adapter.addSvnRemote(localBranchName, svnUrl);
      if (!addResult) {
        results.push({
          projectName: project.name,
          success: false,
          message: `Failed to add SVN remote`,
        });
        continue;
      }

      // 2. Fetch 该 remote（仅当分支不存在时）
      const fetchResult = await adapter.fetchSvnRemote(localBranchName);
      if (!fetchResult.success) {
        results.push({
          projectName: project.name,
          success: false,
          message: `Failed to fetch: ${fetchResult.message}`,
        });
        continue;
      }

      // 3. 切换到对应分支
      const switchResult = await adapter.switchToSvnRemote(localBranchName);
      results.push({
        projectName: project.name,
        success: switchResult,
        message: switchResult ? `Switched to ${localBranchName}` : `Failed to switch to ${localBranchName}`,
      });
    }

    // 刷新仓库状态
    await this.refreshRepositories();

    return this.aggregateResults(results);
  }

  dispose(): void {
    this.onRepositoriesChangeEmitter.dispose();
  }
}
