import * as vscode from 'vscode';
import { Repository, RepositoryState } from '../models';
import { RepositoryManager } from '../services';

/**
 * 项目 TreeView 节点
 */
export class ProjectTreeItem extends vscode.TreeItem {
  constructor(
    public readonly repository: Repository,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(repository.name, collapsibleState);

    this.contextValue = 'project';
    this.description = this.getDescription();
    this.iconPath = this.getIcon();
    this.tooltip = this.getTooltip();
  }

  private getDescription(): string {
    const parts: string[] = [];
    parts.push(this.repository.branch);

    if (this.repository.uncommittedChanges > 0) {
      parts.push(`✎ ${this.repository.uncommittedChanges}`);
    }

    if (!this.repository.isGitSvn) {
      parts.push('(仅 git)');
    }

    return parts.join('  ');
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.repository.state) {
      case RepositoryState.Clean:
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      case RepositoryState.Modified:
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
      case RepositoryState.Conflict:
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      default:
        return new vscode.ThemeIcon('question');
    }
  }

  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;

    // 标题
    md.appendMarkdown(`**${this.repository.name}**\n\n`);

    // 分支
    md.appendMarkdown(`$(git-branch) \`${this.repository.branch}\``);

    // 状态
    const stateMap: Record<string, string> = {
      clean: '$(pass) clean',
      modified: '$(warning) modified',
      conflict: '$(error) conflict',
    };
    md.appendMarkdown(` · ${stateMap[this.repository.state] || this.repository.state}`);

    // 改动数
    if (this.repository.uncommittedChanges > 0) {
      md.appendMarkdown(` · $(edit) ${this.repository.uncommittedChanges} 个改动`);
    }

    md.appendMarkdown(`\n\n`);

    // SVN 信息
    if (this.repository.isGitSvn && this.repository.svnUrl) {
      md.appendMarkdown(`$(remote) \`${this.repository.svnUrl}\`\n\n`);
    } else if (!this.repository.isGitSvn) {
      md.appendMarkdown(`$(alert) 仅 Git（非 Git-SVN）\n\n`);
    }

    // 路径
    md.appendMarkdown(`$(folder) \`${this.repository.path}\``);

    return md;
  }
}

/**
 * 项目 TreeView Provider
 */
export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProjectTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repositoryManager: RepositoryManager;

  constructor() {
    this.repositoryManager = RepositoryManager.getInstance();

    // 监听仓库变更
    this.repositoryManager.onRepositoriesChange(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ProjectTreeItem): Promise<ProjectTreeItem[]> {
    if (element) {
      // 项目节点没有子节点
      return [];
    }

    const repositories = this.repositoryManager.getRepositories();
    return repositories.map(
      (repo) => new ProjectTreeItem(repo, vscode.TreeItemCollapsibleState.None)
    );
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
