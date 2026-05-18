import * as path from 'path';
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import { logger } from '../utils/logger';
import { FileChange, OperationResult } from '../models';
import { GitSvnCommandRunner } from './GitSvnCommandRunner';

export interface RebaseResult {
  success: boolean;
  message: string;
  updatedFiles?: number;
  changes?: FileChange[];
}

export interface DcommitResult {
  success: boolean;
  message: string;
  committedRevisions?: string[];
}

export interface GitStatus {
  branch: string;
  isClean: boolean;
  modified: number;
  staged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

/**
 * Git-SVN 适配器
 * 封装底层 git 和 git-svn 命令
 */
export class GitSvnAdapter {
  private repoPath: string;
  private git: SimpleGit;
  private commandRunner: GitSvnCommandRunner;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
    this.commandRunner = GitSvnCommandRunner.getInstance();
  }

  /**
   * 检查是否是 git 仓库
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否是 git-svn 仓库
   */
  async isGitSvnRepository(): Promise<boolean> {
    try {
      const { existsSync, lstatSync, readFileSync } = await import('fs');
      const gitPath = path.join(this.repoPath, '.git');

      // 解析真实的 git 目录
      let gitDir = gitPath;
      try {
        const stat = lstatSync(gitPath);
        if (stat.isFile()) {
          // worktree: .git 是文件，内容格式 gitdir: <path>
          const content = readFileSync(gitPath, 'utf-8');
          const match = content.match(/^gitdir:\s*(.+)$/m);
          if (match) {
            gitDir = match[1].trim();
          }
        }
      } catch {
        return false;
      }

      // worktree 的 gitdir 指向 <main>/.git/worktrees/<name>
      // svn 元数据在 <main>/.git/svn/，需通过 commondir 文件跳转
      const commondirFile = path.join(gitDir, 'commondir');
      if (existsSync(commondirFile)) {
        const relativeCommonDir = readFileSync(commondirFile, 'utf-8').trim();
        gitDir = path.resolve(gitDir, relativeCommonDir);
      }

      const svnDir = path.join(gitDir, 'svn');
      return existsSync(svnDir);
    } catch {
      return false;
    }
  }

  /**
   * 获取当前分支
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * 获取仓库状态
   */
  async getStatus(): Promise<GitStatus> {
    try {
      const status: StatusResult = await this.git.status();
      return {
        branch: status.current || 'unknown',
        isClean: status.isClean(),
        modified: status.modified.length,
        staged: status.staged.length,
        untracked: status.not_added.length,
        ahead: status.ahead,
        behind: status.behind,
      };
    } catch (error) {
      logger.error(`Failed to get status for ${this.repoPath}`, error);
      return {
        branch: 'unknown',
        isClean: false,
        modified: 0,
        staged: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
      };
    }
  }

  /**
   * 执行 git svn rebase
   */
  async rebase(): Promise<RebaseResult> {
    const beforeRev = await this.getRevision();
    const result = (await this.executeGitSvnCommand(['svn', 'rebase'])) as RebaseResult;
    const afterRev = await this.getRevision();

    if (result.success && beforeRev && afterRev && beforeRev !== afterRev) {
      result.changes = await this.getDiffSummary(beforeRev, afterRev);
      result.updatedFiles = result.changes.length;
    }
    return result;
  }

  /**
   * 执行 git svn dcommit
   */
  async dcommit(): Promise<DcommitResult> {
    return this.executeGitSvnCommand(['svn', 'dcommit']);
  }

  /**
   * 执行 git svn fetch
   */
  async fetch(): Promise<RebaseResult> {
    return this.executeGitSvnCommand(['svn', 'fetch']) as Promise<RebaseResult>;
  }

  /**
   * 克隆 svn 仓库
   */
  static async clone(
    svnUrl: string,
    targetPath: string,
    remoteName: string = 'svn',
    revision?: string
  ): Promise<RebaseResult> {
    const args = ['svn', 'clone', '--remote', remoteName, svnUrl, targetPath];
    if (revision) {
      args.push('-r', revision);
    }

    logger.info(`Cloning ${svnUrl} to ${targetPath}`);

    const result = await GitSvnCommandRunner.getInstance().runGitSvnCommand(args, {
      cwd: path.dirname(targetPath),
      authUrl: svnUrl,
      repoLabel: path.basename(targetPath),
      terminalTitle: `MGitSVN Clone ${path.basename(targetPath)}`,
    });

    return {
      success: result.success,
      message: result.success ? `Clone completed: ${result.stdout}` : result.message,
    };
  }

  /**
   * 切换分支
   */
  async checkout(branch: string): Promise<boolean> {
    try {
      await this.git.checkout(branch);
      return true;
    } catch (error) {
      logger.error(`Failed to checkout ${branch} in ${this.repoPath}`, error);
      return false;
    }
  }

  /**
   * 创建并切换到新分支
   */
  async checkoutNewBranch(branch: string): Promise<boolean> {
    try {
      await this.git.checkoutLocalBranch(branch);
      return true;
    } catch (error) {
      logger.error(`Failed to create branch ${branch} in ${this.repoPath}`, error);
      return false;
    }
  }

  /**
   * 获取所有分支
   */
  async getBranches(): Promise<string[]> {
    try {
      const result = await this.git.branchLocal();
      return result.all;
    } catch {
      return [];
    }
  }

  /**
   * 检查分支是否存在
   */
  async branchExists(branch: string): Promise<boolean> {
    const branches = await this.getBranches();
    return branches.includes(branch);
  }

  /**
   * 获取 worktree 列表
   */
  async getWorktrees(): Promise<{ path: string; branch: string }[]> {
    try {
      const result = await this.git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: { path: string; branch: string }[] = [];
      const lines = result.split('\n');

      let currentPath = '';
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.substring(9);
        } else if (line.startsWith('branch ')) {
          const branch = line.substring(7).replace('refs/heads/', '');
          worktrees.push({ path: currentPath, branch });
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  /**
   * 添加 worktree
   */
  async addWorktree(targetPath: string, branch: string, createBranch = true): Promise<boolean> {
    try {
      const args = ['worktree', 'add', targetPath];
      if (createBranch) {
        args.push('-b', branch);
      } else {
        args.push(branch);
      }
      await this.git.raw(args);
      return true;
    } catch (error) {
      logger.error(`Failed to add worktree ${targetPath}`, error);
      return false;
    }
  }

  /**
   * 移除 worktree
   */
  async removeWorktree(targetPath: string): Promise<boolean> {
    try {
      await this.git.raw(['worktree', 'remove', targetPath]);
      return true;
    } catch (error) {
      logger.error(`Failed to remove worktree ${targetPath}`, error);
      return false;
    }
  }

  /**
   * 清理 worktree
   */
  async pruneWorktrees(): Promise<void> {
    try {
      await this.git.raw(['worktree', 'prune']);
    } catch (error) {
      logger.error(`Failed to prune worktrees`, error);
    }
  }

  /**
   * 删除本地分支
   */
  async deleteBranch(branch: string, force = false): Promise<boolean> {
    try {
      const args = ['branch', force ? '-D' : '-d', branch];
      await this.git.raw(args);
      return true;
    } catch (error) {
      logger.error(`Failed to delete branch ${branch}`, error);
      return false;
    }
  }

  /**
   * 重命名本地分支
   */
  async renameBranch(oldName: string, newName: string): Promise<boolean> {
    try {
      await this.git.raw(['branch', '-m', oldName, newName]);
      return true;
    } catch (error) {
      logger.error(`Failed to rename branch from ${oldName} to ${newName}`, error);
      return false;
    }
  }

  /**
   * 合并分支
   */
  async mergeBranch(sourceBranch: string): Promise<OperationResult> {
    const projectName = path.basename(this.repoPath);
    logger.info(`git merge ${sourceBranch}  (cwd: ${this.repoPath})`);
    try {
      const result = await this.git.merge([sourceBranch]);
      if (result.failed) {
        return {
          projectName,
          success: false,
          message: result.conflicts?.length
            ? `合并冲突: ${result.conflicts.map(c => c.file).join(', ')}`
            : '合并失败',
        };
      }
      return {
        projectName,
        success: true,
        message: result.summary?.insertions !== undefined
          ? `已合并: +${result.summary.insertions} -${result.summary.deletions}`
          : '已合并',
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // git merge 有冲突时会抛异常，检查冲突文件
      if (errMsg.includes('CONFLICT') || errMsg.includes('conflict')) {
        return {
          projectName,
          success: false,
          message: `合并冲突，请手动解决: ${errMsg.split('\n')[0]}`,
        };
      }
      logger.error(`Failed to merge ${sourceBranch} in ${projectName}`, error);
      return {
        projectName,
        success: false,
        message: errMsg,
      };
    }
  }

  /**
   * 获取当前版本号
   */
  async getRevision(): Promise<string | undefined> {
    try {
      const rev = await this.git.revparse(['HEAD']);
      return rev.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * 获取两个版本之间的差异摘要
   */
  async getDiffSummary(from: string, to: string): Promise<FileChange[]> {
    try {
      const result = await this.git.raw(['diff', '--name-status', from, to]);
      return result
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const [status, filePath] = line.split(/\s+/);
          return { status: status.substring(0, 1), path: filePath };
        });
    } catch (error) {
      logger.error('Failed to get diff summary', error);
      return [];
    }
  }

  /**
   * 执行 git-svn 命令
   */
  private executeGitSvnCommand(args: string[]): Promise<RebaseResult | DcommitResult> {
    return this.resolveAuthUrl(args).then((authUrl) =>
      this.commandRunner.runGitSvnCommand(args, {
        cwd: this.repoPath,
        authUrl,
        repoLabel: path.basename(this.repoPath),
        terminalTitle: `MGitSVN ${path.basename(this.repoPath)}`,
      })
    );
  }

  /**
   * 获取 SVN URL
   */
  async getSvnUrl(): Promise<string | undefined> {
    try {
      const result = await this.git.raw(['svn', 'info', '--url']);
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * 获取所有 SVN remotes
   */
  async getSvnRemotes(): Promise<Record<string, string>> {
    const remotes: Record<string, string> = {};

    try {
      // 读取 git config 获取所有 svn-remote
      const result = await this.git.raw(['config', '--get-regexp', '^svn-remote\\..*\\.url$']);
      const lines = result.trim().split('\n').filter(l => l);

      for (const line of lines) {
        // 格式: svn-remote.xxx.url svn://...
        const match = line.match(/^svn-remote\.(.+)\.url\s+(.+)$/);
        if (match) {
          remotes[match[1]] = match[2];
        }
      }
    } catch {
      // 如果没有配置，尝试获取默认的 svn remote
      const defaultUrl = await this.getSvnUrl();
      if (defaultUrl) {
        remotes['svn'] = defaultUrl;
      }
    }

    return remotes;
  }

  /**
   * 添加 SVN remote
   */
  async addSvnRemote(remoteName: string, svnUrl: string): Promise<boolean> {
    try {
      // 检查是否已存在
      const remotes = await this.getSvnRemotes();
      if (remotes[remoteName]) {
        logger.info(`SVN remote ${remoteName} already exists`);
        return true;
      }

      // 添加 svn-remote 配置
      await this.git.raw(['config', '--add', `svn-remote.${remoteName}.url`, svnUrl]);
      await this.git.raw(['config', '--add', `svn-remote.${remoteName}.fetch`, `:refs/remotes/${remoteName}`]);

      logger.info(`Added SVN remote: ${remoteName} -> ${svnUrl}`);
      return true;
    } catch (error) {
      logger.error(`Failed to add SVN remote ${remoteName}`, error);
      return false;
    }
  }

  /**
   * 拉取指定 SVN remote
   */
  async fetchSvnRemote(remoteName: string): Promise<RebaseResult> {
    const projectName = path.basename(this.repoPath);
    logger.info(`Fetching SVN remote: ${remoteName} in ${projectName}`);

    const remotes = await this.getSvnRemotes();
    const result = await this.commandRunner.runGitSvnCommand(['svn', 'fetch', remoteName, '-r', 'HEAD'], {
      cwd: this.repoPath,
      authUrl: remotes[remoteName],
      repoLabel: projectName,
      terminalTitle: `MGitSVN Fetch ${projectName}`,
    });

    return {
      success: result.success,
      message: result.success ? result.stdout || `Fetched ${remoteName} successfully` : result.message,
    };
  }

  /**
   * 解析当前命令对应的认证 URL
   */
  private async resolveAuthUrl(args: string[]): Promise<string | undefined> {
    const remotes = await this.getSvnRemotes();

    if (args[0] === 'svn' && args[1] === 'fetch' && args[2]) {
      return remotes[args[2]];
    }

    const currentBranch = await this.getCurrentBranch();
    if (remotes[currentBranch]) {
      return remotes[currentBranch];
    }

    if (remotes.svn) {
      return remotes.svn;
    }

    const remoteNames = Object.keys(remotes);
    return remoteNames.length > 0 ? remotes[remoteNames[0]] : undefined;
  }

  /**
   * 切换到指定 SVN remote 的分支
   * 如果本地分支不存在，则创建
   */
  async switchToSvnRemote(remoteName: string): Promise<boolean> {
    try {
      // 先检查是否有这个 remote 的分支
      const branches = await this.getBranches();

      if (branches.includes(remoteName)) {
        // 分支已存在，直接切换
        return await this.checkout(remoteName);
      }

      // 检查是否有对应的 remote ref
      try {
        await this.git.raw(['rev-parse', `refs/remotes/${remoteName}`]);
        // 有 remote ref，创建并切换到本地分支
        await this.git.raw(['checkout', '-b', remoteName, `refs/remotes/${remoteName}`]);
        logger.info(`Created and switched to branch: ${remoteName}`);
        return true;
      } catch {
        logger.error(`No remote ref found for ${remoteName}`);
        return false;
      }
    } catch (error) {
      logger.error(`Failed to switch to SVN remote ${remoteName}`, error);
      return false;
    }
  }

  /**
   * 获取当前 SVN remote 名称（基于当前分支）
   */
  async getCurrentSvnRemote(): Promise<string | undefined> {
    try {
      const branch = await this.getCurrentBranch();
      const remotes = await this.getSvnRemotes();

      // 如果当前分支名与某个 remote 名相同，返回该 remote
      if (remotes[branch]) {
        return branch;
      }

      // 默认返回 'svn' 或第一个 remote
      if (remotes['svn']) {
        return 'svn';
      }

      const remoteNames = Object.keys(remotes);
      return remoteNames.length > 0 ? remoteNames[0] : undefined;
    } catch {
      return undefined;
    }
  }
}
