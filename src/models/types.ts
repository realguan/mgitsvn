/**
 * 项目配置
 */
export interface ProjectConfig {
  /** 项目名称 */
  name: string;
  /** 相对路径 */
  path: string;
  /** 多个 SVN Remote 配置 (key: remote名称, value: SVN URL) */
  svnRemotes: Record<string, string>;
  /** 是否启用 */
  enabled?: boolean;
  /** 项目来源 */
  source?: 'manual' | 'external';
  /** external 元信息 */
  external?: ProjectExternalMeta;
}

/**
 * Worktree 同步项配置
 */
export interface WorktreeSyncItem {
  /** 源路径（相对于 rootDir） */
  source: string;
  /** 同步方式: 'symlink' 软链接, 'copy' 复制 */
  mode: 'symlink' | 'copy';
}

/**
 * 插件配置
 */
export interface MgitsvnConfig {
  /** 根目录 */
  rootDir: string;
  /** 项目列表 */
  projects: ProjectConfig[];
  /** worktree 基础目录 */
  worktreeBaseDir: string;
  /** worktree 同步配置：创建 worktree 时自动同步的文件/目录 */
  worktreeSync?: WorktreeSyncItem[];
  /** externals 配置 */
  externals?: MgitsvnExternalsConfig;
}

export interface ProjectExternalMeta {
  /** 所属主项目 */
  ownerProject: string;
  /** external 相对路径 */
  localRelativePath: string;
  /** 原始 externals 定义 */
  rawLine: string;
  /** externals 属性所在 URL */
  propertyTargetUrl: string;
}

export interface FileExternalRule {
  /** 所属主项目 */
  ownerProject: string;
  /** 主项目根路径 */
  ownerProjectPath: string;
  /** 挂载相对路径 */
  localRelativePath: string;
  /** 源文件 URL */
  sourceUrl: string;
  /** 固定 revision */
  sourceRevision?: string;
  /** 建链方式 */
  linkMode: 'symlink' | 'copy';
  /** 原始 externals 定义 */
  rawLine: string;
  /** 是否启用 */
  enabled: boolean;
}

export interface MgitsvnExternalsConfig {
  /** clone 后自动扫描 */
  autoScanAfterClone?: boolean;
  /** 目录 external 处理方式 */
  directoryMode?: 'prompt' | 'auto-manage' | 'ignore';
  /** 文件 external 处理方式 */
  fileMode?: 'prompt' | 'auto-link' | 'ignore';
  /** 文件 external 默认建链方式 */
  defaultFileLinkMode?: 'symlink' | 'copy';
  /** 文件 external 规则 */
  fileRules?: FileExternalRule[];
  /** 忽略的 externals 定义 */
  ignoredDefinitions?: string[];
}

export interface SvnStoredCredential {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 更新时间 */
  updatedAt: string;
}

export interface FileChange {
  status: string; // A, M, D, R, etc.
  path: string;
}

/**
 * 仓库状态
 */
export enum RepositoryState {
  Clean = 'clean',
  Modified = 'modified',
  Conflict = 'conflict',
  Unknown = 'unknown',
}

/**
 * 仓库信息
 */
export interface Repository {
  /** 项目名称 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 当前分支 */
  branch: string;
  /** 仓库状态 */
  state: RepositoryState;
  /** 未提交变更数 */
  uncommittedChanges: number;
  /** 是否是 git-svn 仓库 */
  isGitSvn: boolean;
  /** SVN URL */
  svnUrl?: string;
  /** 当前使用的 SVN Remote 名称 */
  currentSvnRemote?: string;
  /** 可用的 SVN Remotes */
  svnRemotes?: Record<string, string>;
}

/**
 * 批量操作结果
 */
export interface BatchResult {
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  failureCount: number;
  /** 详细结果 */
  results: OperationResult[];
}

/**
 * 单个操作结果
 */
export interface OperationResult {
  /** 项目名称 */
  projectName: string;
  /** 是否成功 */
  success: boolean;
  /** 消息 */
  message: string;
  /** 错误信息 */
  error?: string;
  /** 变更文件列表 */
  changes?: FileChange[];
}

/**
 * Worktree 信息
 */
export interface WorktreeInfo {
  /** 分支名 */
  branch: string;
  /** 根路径 */
  rootPath: string;
  /** 包含的项目 */
  projects: WorktreeProject[];
}

/**
 * Worktree 中的项目
 */
export interface WorktreeProject {
  /** 项目名称 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否存在 */
  exists: boolean;
}
