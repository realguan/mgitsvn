import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { SvnCredentialService } from './SvnCredentialService';
import { SvnAuthBootstrapService } from './SvnAuthBootstrapService';
import { classifySvnAuthError } from './SvnAuthErrorClassifier';
import { ConfigurationManager } from './ConfigurationManager';
import { SvnStoredCredential } from '../models';
import { logger } from '../utils/logger';

export interface CommandExecutionResult {
  success: boolean;
  message: string;
  stdout: string;
  stderr: string;
  code: number | null;
  usedTerminal?: boolean;
}

export interface CommandExecutionOptions {
  cwd: string;
  authUrl?: string;
  executionMode?: 'background' | 'interactive-task' | 'auto';
  repoLabel?: string;
  terminalTitle?: string;
}

/**
 * 统一 SVN / Git-SVN 命令执行器
 * 负责后台执行、认证预热和终端回退
 */
export class GitSvnCommandRunner {
  private static instance: GitSvnCommandRunner;
  private readonly configManager = ConfigurationManager.getInstance();
  private readonly credentialService = new SvnCredentialService();
  private readonly bootstrapService = SvnAuthBootstrapService.getInstance();

  private constructor() {}

  static getInstance(): GitSvnCommandRunner {
    if (!GitSvnCommandRunner.instance) {
      GitSvnCommandRunner.instance = new GitSvnCommandRunner();
    }
    return GitSvnCommandRunner.instance;
  }

  async runGitSvnCommand(
    args: string[],
    options: CommandExecutionOptions
  ): Promise<CommandExecutionResult> {
    return this.runCommand('git', args, options);
  }

  async runSvnCommand(
    args: string[],
    options: CommandExecutionOptions & { stdin?: string }
  ): Promise<CommandExecutionResult> {
    return this.runCommand('svn', args, options, options.stdin);
  }

  async ensureCredential(rawUrl: string): Promise<SvnStoredCredential | undefined> {
    const existing = await this.credentialService.getCredential(rawUrl);
    if (existing) {
      return existing;
    }

    return this.promptForCredential(rawUrl);
  }

  private async runCommand(
    executable: 'git' | 'svn',
    args: string[],
    options: CommandExecutionOptions,
    stdin?: string
  ): Promise<CommandExecutionResult> {
    const executionMode = options.executionMode ?? this.configManager.getAuthMode();

    if (executionMode === 'interactive-task') {
      return this.runInInteractiveTask(executable, args, options);
    }

    const firstAttempt = await this.runInBackground(executable, args, options, undefined, stdin);
    if (firstAttempt.success || !options.authUrl || !this.isCredentialManagedUrl(options.authUrl)) {
      return firstAttempt;
    }

    const classification = classifySvnAuthError(firstAttempt);
    if (!classification.shouldRetryWithCredentials) {
      if (classification.shouldFallbackToTerminal && this.configManager.shouldFallbackToInteractiveTerminal()) {
        return this.runInInteractiveTask(executable, args, options);
      }
      return firstAttempt;
    }

    let credential = await this.credentialService.getCredential(options.authUrl);
    if (!credential) {
      credential = await this.promptForCredential(options.authUrl);
      if (!credential) {
        return {
          ...firstAttempt,
          message: '用户取消了 SVN 凭据输入',
        };
      }
    }

    const bootstrapResult = await this.bootstrapService.bootstrap(options.authUrl, credential);
    if (!bootstrapResult.success) {
      logger.warn(`SVN auth bootstrap failed: ${bootstrapResult.message}`);
      if (this.configManager.shouldFallbackToInteractiveTerminal()) {
        return this.runInInteractiveTask(executable, args, options);
      }
      return {
        ...firstAttempt,
        message: bootstrapResult.message,
      };
    }

    const secondAttempt = await this.runInBackground(executable, args, options, credential, stdin);
    if (secondAttempt.success) {
      return secondAttempt;
    }

    const secondClassification = classifySvnAuthError(secondAttempt);
    if (secondClassification.kind !== 'other' && this.configManager.shouldFallbackToInteractiveTerminal()) {
      return this.runInInteractiveTask(executable, args, options);
    }

    return secondAttempt;
  }

  private async runInBackground(
    executable: 'git' | 'svn',
    args: string[],
    options: CommandExecutionOptions,
    credential?: SvnStoredCredential,
    stdin?: string
  ): Promise<CommandExecutionResult> {
    const effectiveArgs = this.withManagedAuthOptions(executable, args, options.authUrl, credential);
    const label = options.repoLabel ?? path.basename(options.cwd);
    logger.info(`Executing ${executable} command in background: ${executable} ${effectiveArgs.join(' ')} @ ${label}`);

    return new Promise((resolve) => {
      const proc = spawn(executable, effectiveArgs, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        chunk
          .split('\n')
          .filter((line: string) => line.trim())
          .forEach((line: string) => logger.info(`[${label}] ${line}`));
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        chunk
          .split('\n')
          .filter((line: string) => line.trim())
          .forEach((line: string) => logger.warn(`[${label}] ${line}`));
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          message: code === 0 ? stdout || 'Operation completed successfully' : stderr || stdout || 'Operation failed',
          stdout,
          stderr,
          code,
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          message: error.message,
          stdout,
          stderr,
          code: null,
        });
      });

      if (stdin) {
        proc.stdin.write(stdin);
      }
      proc.stdin.end();
    });
  }

  private async runInInteractiveTask(
    executable: 'git' | 'svn',
    args: string[],
    options: CommandExecutionOptions
  ): Promise<CommandExecutionResult> {
    const effectiveArgs = this.withManagedAuthOptions(executable, args, options.authUrl);
    const taskName = `${options.terminalTitle ?? 'SVN Authentication'} #${Date.now()}`;
    const commandLine = [executable, ...effectiveArgs].map(this.quoteArg).join(' ');

    logger.warn(`Falling back to interactive terminal: ${commandLine}`);

    const execution = new vscode.ShellExecution(commandLine, { cwd: options.cwd });
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Workspace,
      taskName,
      'MGitSVN',
      execution
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
      focus: true,
      clear: true,
    };

    return new Promise(async (resolve) => {
      const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution.task.name !== taskName || event.execution.task.source !== 'MGitSVN') {
          return;
        }

        disposable.dispose();
        resolve({
          success: event.exitCode === 0,
          message:
            event.exitCode === 0
              ? 'Interactive terminal command completed successfully'
              : `Interactive terminal command failed with exit code ${event.exitCode ?? 'unknown'}`,
          stdout: '',
          stderr: '',
          code: event.exitCode ?? null,
          usedTerminal: true,
        });
      });

      await vscode.tasks.executeTask(task);
    });
  }

  private async promptForCredential(rawUrl: string): Promise<SvnStoredCredential | undefined> {
    const existing = await this.credentialService.getCredential(rawUrl);
    const username = await vscode.window.showInputBox({
      prompt: `输入 SVN 用户名 (${SvnAuthBootstrapService.maskUrl(rawUrl)})`,
      value: existing?.username,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() === '' ? '用户名不能为空' : null),
    });

    if (!username) {
      return undefined;
    }

    const password = await vscode.window.showInputBox({
      prompt: `输入 SVN 密码 (${username})`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() === '' ? '密码不能为空' : null),
    });

    if (!password) {
      return undefined;
    }

    const credential: SvnStoredCredential = {
      username,
      password,
      updatedAt: new Date().toISOString(),
    };

    if (this.configManager.shouldRememberCredentials()) {
      await this.credentialService.saveCredential(rawUrl, credential);
    }

    return credential;
  }

  private withManagedAuthOptions(
    executable: 'git' | 'svn',
    args: string[],
    authUrl?: string,
    credential?: SvnStoredCredential
  ): string[] {
    if (!authUrl || !this.isCredentialManagedUrl(authUrl)) {
      return [...args];
    }

    const configDir = this.bootstrapService.getManagedConfigDir();

    if (executable === 'svn') {
      const merged = [...args];
      if (!merged.includes('--config-dir')) {
        merged.splice(1, 0, '--config-dir', configDir);
      }
      if (credential?.username && !merged.includes('--username')) {
        merged.splice(1, 0, '--username', credential.username);
      }
      return merged;
    }

    if (args[0] !== 'svn' || args.length < 2) {
      return [...args];
    }

    const merged = [...args];
    const insertIndex = 2;

    if (!merged.includes('--config-dir')) {
      merged.splice(insertIndex, 0, '--config-dir', configDir);
    }

    if (credential?.username && !merged.includes('--username')) {
      merged.splice(insertIndex, 0, '--username', credential.username);
    }

    return merged;
  }

  private isCredentialManagedUrl(rawUrl: string): boolean {
    return rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
  }

  private quoteArg(arg: string): string {
    if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) {
      return arg;
    }

    return `'${arg.replace(/'/g, `'\\''`)}'`;
  }
}
