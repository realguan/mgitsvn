import * as vscode from 'vscode';
import { WorktreeInfo } from '../models';
import { WorktreeManager, ConfigurationManager } from '../services';

/**
 * Worktree TreeView 节点类型
 */
type WorktreeTreeItemType = 'worktree' | 'project';

/**
 * Worktree TreeView 节点
 */
export class WorktreeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: WorktreeTreeItemType,
    public readonly worktreeInfo?: WorktreeInfo,
    public readonly projectPath?: string,
    public readonly projectExists?: boolean
  ) {
    super(label, collapsibleState);

    this.contextValue = itemType;

    if (itemType === 'worktree') {
      this.iconPath = new vscode.ThemeIcon('git-branch');
      const existingCount = worktreeInfo?.projects.filter((p) => p.exists).length ?? 0;
      const totalCount = worktreeInfo?.projects.length ?? 0;
      this.description = `${existingCount}/${totalCount} 个项目`;
      this.tooltip = this.getWorktreeTooltip();
    } else {
      // 工作树下的项目子节点
      this.contextValue = projectExists ? 'worktreeProject' : 'worktreeProjectMissing';
      this.iconPath = projectExists
        ? new vscode.ThemeIcon('folder')
        : new vscode.ThemeIcon('folder', new vscode.ThemeColor('disabledForeground'));
      this.description = projectExists ? '' : '(缺失)';

      // 存在的项目可以点击打开文件夹
      if (projectExists && projectPath) {
        this.command = {
          command: 'vscode.openFolder',
          title: '打开文件夹',
          arguments: [vscode.Uri.file(projectPath), { forceNewWindow: true }],
        };
        this.tooltip = new vscode.MarkdownString(`点击在新窗口打开\n\n\`${projectPath}\``);
      } else {
        this.tooltip = new vscode.MarkdownString(`⚠️ 项目文件夹不存在\n\n\`${projectPath || '未知路径'}\``);
      }
    }
  }

  private getWorktreeTooltip(): vscode.MarkdownString {
    if (!this.worktreeInfo) {
      return new vscode.MarkdownString();
    }

    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    md.appendMarkdown(`**${this.worktreeInfo.branch}**\n\n`);

    const existingCount = this.worktreeInfo.projects.filter((p) => p.exists).length;
    const totalCount = this.worktreeInfo.projects.length;
    md.appendMarkdown(`$(repo) ${existingCount}/${totalCount} 个项目`);

    if (existingCount < totalCount) {
      const missing = this.worktreeInfo.projects.filter((p) => !p.exists).map((p) => p.name);
      md.appendMarkdown(` · $(warning) 缺失: ${missing.join(', ')}`);
    }

    md.appendMarkdown(`\n\n$(folder) \`${this.worktreeInfo.rootPath}\``);

    return md;
  }
}

/**
 * Worktree TreeView Provider
 */
export class WorktreeTreeProvider implements vscode.TreeDataProvider<WorktreeTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WorktreeTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private worktreeManager: WorktreeManager;
  private configManager: ConfigurationManager;
  private worktrees: WorktreeInfo[] = [];

  constructor() {
    this.worktreeManager = WorktreeManager.getInstance();
    this.configManager = ConfigurationManager.getInstance();

    // 监听 worktree 变更
    this.worktreeManager.onWorktreesChange((worktrees) => {
      this.worktrees = worktrees;
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async loadWorktrees(): Promise<void> {
    this.worktrees = await this.worktreeManager.listWorktrees();
    this.refresh();
  }

  getTreeItem(element: WorktreeTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WorktreeTreeItem): Promise<WorktreeTreeItem[]> {
    if (!element) {
      // 根节点：返回所有 worktree
      return this.worktrees.map((wt) => {
        return new WorktreeTreeItem(
          wt.branch,
          vscode.TreeItemCollapsibleState.Collapsed,
          'worktree',
          wt
        );
      });
    }

    // 展开 worktree：返回其中的项目
    if (element.itemType === 'worktree' && element.worktreeInfo) {
      return element.worktreeInfo.projects.map(
        (project) =>
          new WorktreeTreeItem(
            project.name,
            vscode.TreeItemCollapsibleState.None,
            'project',
            undefined,
            project.path,
            project.exists
          )
      );
    }

    return [];
  }

  /**
   * 获取 worktree 信息
   */
  getWorktreeInfo(branch: string): WorktreeInfo | undefined {
    return this.worktrees.find((wt) => wt.branch === branch);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
