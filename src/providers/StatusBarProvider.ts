import * as vscode from 'vscode';
import { RepositoryManager } from '../services';
import { RepositoryState } from '../models';

/**
 * 状态栏 Provider
 * 在状态栏显示同步状态和当前分支
 */
export class StatusBarProvider {
  private statusBarItem: vscode.StatusBarItem;
  private repositoryManager: RepositoryManager;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'mgitsvn.statusAll';
    this.repositoryManager = RepositoryManager.getInstance();

    // 监听仓库变更
    this.repositoryManager.onRepositoriesChange(() => {
      this.update();
    });

    this.statusBarItem.show();
  }

  /**
   * 更新状态栏
   */
  update(): void {
    const repos = this.repositoryManager.getRepositories();

    if (repos.length === 0) {
      this.statusBarItem.text = '$(git-branch) MGitSVN: 无项目';
      this.statusBarItem.tooltip = '未配置项目';
      return;
    }

    // 统计状态
    const cleanCount = repos.filter((r) => r.state === RepositoryState.Clean).length;
    const modifiedCount = repos.filter((r) => r.state === RepositoryState.Modified).length;
    const conflictCount = repos.filter((r) => r.state === RepositoryState.Conflict).length;
    const totalChanges = repos.reduce((sum, r) => sum + r.uncommittedChanges, 0);

    // 获取主要分支（最常见的分支）
    const branchCounts = new Map<string, number>();
    repos.forEach((r) => {
      const count = branchCounts.get(r.branch) || 0;
      branchCounts.set(r.branch, count + 1);
    });
    const mainBranch = Array.from(branchCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '未知';

    // 构建状态文本
    let text = `$(git-branch) ${cleanCount}/${repos.length}`;
    if (modifiedCount > 0 || conflictCount > 0) {
      text += ` $(warning) ${modifiedCount + conflictCount}`;
    }
    text += ` | ${mainBranch}`;

    if (totalChanges > 0) {
      text += ` $(edit) ${totalChanges}`;
    }

    this.statusBarItem.text = text;

    // 构建 tooltip
    const tooltip = new vscode.MarkdownString();
    tooltip.supportThemeIcons = true;
    tooltip.appendMarkdown('**MGitSVN 状态概览**\n\n');

    // 状态摘要 — 一行紧凑展示
    tooltip.appendMarkdown(`$(pass) ${cleanCount} 干净`);
    if (modifiedCount > 0) {
      tooltip.appendMarkdown(` · $(warning) ${modifiedCount} 已修改`);
    }
    if (conflictCount > 0) {
      tooltip.appendMarkdown(` · $(error) ${conflictCount} 冲突`);
    }
    if (totalChanges > 0) {
      tooltip.appendMarkdown(` · $(edit) ${totalChanges} 改动`);
    }
    tooltip.appendMarkdown(`\n\n`);

    // 分支分布
    if (branchCounts.size > 1) {
      tooltip.appendMarkdown(`**分支分布**\n\n`);
      const sortedBranches = Array.from(branchCounts.entries()).sort((a, b) => b[1] - a[1]);
      for (const [branch, count] of sortedBranches) {
        const bar = '█'.repeat(Math.ceil(count / repos.length * 10));
        tooltip.appendMarkdown(`\`${branch}\` ${bar} ${count}\n\n`);
      }
    }

    tooltip.appendMarkdown(`---\n*点击查看详情*`);

    this.statusBarItem.tooltip = tooltip;

    // 根据状态设置颜色
    if (conflictCount > 0) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (modifiedCount > 0) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  /**
   * 显示操作中状态
   */
  showBusy(message: string): void {
    this.statusBarItem.text = `$(sync~spin) ${message}`;
    this.statusBarItem.backgroundColor = undefined;
  }

  /**
   * 隐藏状态栏
   */
  hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * 显示状态栏
   */
  show(): void {
    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
