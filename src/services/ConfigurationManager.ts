import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MgitsvnConfig, ProjectConfig } from '../models/types';
import { logger } from '../utils/logger';

const CONFIG_FILE_NAME = '.mgitsvn.json';

/**
 * 配置管理器
 * 负责加载、保存和管理 .mgitsvn.json 配置文件
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private config: MgitsvnConfig | undefined;
  private configPath: string | undefined;
  private onConfigChangeEmitter = new vscode.EventEmitter<MgitsvnConfig>();
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  /** 配置变更事件 */
  public readonly onConfigChange = this.onConfigChangeEmitter.event;

  private constructor() { }

  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * 获取配置文件路径
   */
  getConfigFilePath(): string | undefined {
    return this.configPath;
  }

  /**
   * 初始化配置管理器
   */
  async initialize(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }

    // 在工作区根目录寻找配置文件
    const rootPath = workspaceFolders[0].uri.fsPath;
    const configPath = path.join(rootPath, CONFIG_FILE_NAME);

    if (fs.existsSync(configPath)) {
      this.configPath = configPath;
      const success = this.loadConfig();
      if (success) {
        this.setupFileWatcher();
        return true;
      }
    }

    return false;
  }

  /**
   * 加载配置文件
   */
  loadConfig(): boolean {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(content);
      this.onConfigChangeEmitter.fire(this.config!);
      return true;
    } catch (error) {
      logger.error('Failed to load config', error);
      return false;
    }
  }

  /**
   * 设置文件监听
   */
  private setupFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    if (this.configPath) {
      this.fileWatcher = vscode.workspace.createFileSystemWatcher(this.configPath);
      this.fileWatcher.onDidChange(() => this.loadConfig());
      this.fileWatcher.onDidCreate(() => this.loadConfig());
      this.fileWatcher.onDidDelete(() => {
        this.config = undefined;
        this.configPath = undefined;
      });
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): MgitsvnConfig | undefined {
    return this.config;
  }

  /**
   * 获取项目列表
   */
  getProjects(): ProjectConfig[] {
    return this.config?.projects || [];
  }

  /**
   * 获取根目录（处理相对路径）
   */
  getRootDir(): string {
    if (!this.config?.rootDir) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      return workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
    }

    // 如果是相对路径，相对于配置文件所在目录解析
    if (!path.isAbsolute(this.config.rootDir)) {
      const configDir = this.configPath ? path.dirname(this.configPath) : '';
      return path.resolve(configDir, this.config.rootDir);
    }

    return this.config.rootDir;
  }

  /**
   * 获取 worktree 基础目录（处理相对路径）
   */
  getWorktreeBaseDir(): string {
    const baseDir = this.config?.worktreeBaseDir || path.dirname(this.getRootDir());

    // 如果是相对路径，相对于配置文件所在目录解析
    if (!path.isAbsolute(baseDir)) {
      const configDir = this.configPath ? path.dirname(this.configPath) : '';
      return path.resolve(configDir, baseDir);
    }

    return baseDir;
  }

  /**
   * 保存配置
   */
  async saveConfig(config: MgitsvnConfig): Promise<boolean> {
    if (!this.configPath) {
      return false;
    }

    try {
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf-8');
      this.config = config;
      logger.info('Config saved');
      return true;
    } catch (error) {
      logger.error('Failed to save config', error);
      return false;
    }
  }

  /**
   * 创建初始配置文件
   */
  async createInitialConfig(rootDir: string): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }

    const configPath = path.join(workspaceFolders[0].uri.fsPath, CONFIG_FILE_NAME);

    const config: MgitsvnConfig = {
      rootDir,
      projects: [],
      worktreeBaseDir: path.dirname(rootDir),
    };

    // 自动发现项目
    const projects = await this.discoverProjects(rootDir);
    config.projects = projects;

    try {
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(configPath, content, 'utf-8');
      this.configPath = configPath;
      this.config = config;
      this.setupFileWatcher();
      logger.info(`Initial config created at ${configPath}`);
      return true;
    } catch (error) {
      logger.error('Failed to create initial config', error);
      return false;
    }
  }

  /**
   * 自动发现项目
   */
  private async discoverProjects(rootDir: string): Promise<ProjectConfig[]> {
    const projects: ProjectConfig[] = [];

    if (!fs.existsSync(rootDir)) {
      return projects;
    }

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const projectPath = path.join(rootDir, entry.name);
      const gitDir = path.join(projectPath, '.git');

      if (fs.existsSync(gitDir)) {
        projects.push({
          name: entry.name,
          path: entry.name,
          svnRemotes: {},
          enabled: true,
        });
        logger.info(`Discovered project: ${entry.name}`);
      }
    }

    return projects;
  }

  /**
   * 添加项目
   */
  async addProject(project: ProjectConfig): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    // 检查是否已存在
    const existing = this.config.projects.find((p) => p.name === project.name);
    if (existing) {
      logger.warn(`Project ${project.name} already exists`);
      return false;
    }

    this.config.projects.push(project);
    return this.saveConfig(this.config);
  }

  /**
   * 移除项目
   */
  async removeProject(projectName: string): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    const index = this.config.projects.findIndex((p) => p.name === projectName);
    if (index === -1) {
      return false;
    }

    this.config.projects.splice(index, 1);
    return this.saveConfig(this.config);
  }

  /**
   * 获取 VS Code 设置
   */
  getVSCodeSettings(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('mgitsvn');
  }

  /**
   * 获取并发数
   */
  getConcurrency(): number {
    return this.getVSCodeSettings().get<number>('concurrency', 3);
  }

  /**
   * 是否自动刷新
   */
  isAutoRefresh(): boolean {
    return this.getVSCodeSettings().get<boolean>('autoRefresh', true);
  }

  /**
   * 是否显示通知
   */
  isShowNotifications(): boolean {
    return this.getVSCodeSettings().get<boolean>('showNotifications', true);
  }

  /**
   * 获取认证模式
   */
  getAuthMode(): 'background' | 'interactive-task' | 'auto' {
    return this.getVSCodeSettings().get<'background' | 'interactive-task' | 'auto'>(
      'authMode',
      'auto'
    );
  }

  /**
   * 是否记住 SVN 凭据
   */
  shouldRememberCredentials(): boolean {
    return this.getVSCodeSettings().get<boolean>('rememberCredentials', true);
  }

  /**
   * 认证失败时是否回退到集成终端
   */
  shouldFallbackToInteractiveTerminal(): boolean {
    return this.getVSCodeSettings().get<boolean>('interactiveTerminalOnAuthFailure', true);
  }

  /**
   * 是否在 clone 后自动扫描 externals
   */
  shouldAutoScanExternalsAfterClone(): boolean {
    return this.config?.externals?.autoScanAfterClone ?? true;
  }

  /**
   * 获取目录 external 处理模式
   */
  getDirectoryExternalMode(): 'prompt' | 'auto-manage' | 'ignore' {
    return this.config?.externals?.directoryMode ?? 'prompt';
  }

  /**
   * 获取文件 external 处理模式
   */
  getFileExternalMode(): 'prompt' | 'auto-link' | 'ignore' {
    return this.config?.externals?.fileMode ?? 'prompt';
  }

  /**
   * 获取 file external 默认链接模式
   */
  getDefaultFileExternalLinkMode(): 'symlink' | 'copy' {
    return this.config?.externals?.defaultFileLinkMode ?? 'symlink';
  }

  dispose(): void {
    this.fileWatcher?.dispose();
    this.onConfigChangeEmitter.dispose();
  }
}
