import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * 运行时上下文服务
 * 为服务层提供 SecretStorage 与插件全局缓存目录
 */
export class RuntimeContextService {
  private static instance: RuntimeContextService;
  private context: vscode.ExtensionContext | undefined;

  private constructor() {}

  static getInstance(): RuntimeContextService {
    if (!RuntimeContextService.instance) {
      RuntimeContextService.instance = new RuntimeContextService();
    }
    return RuntimeContextService.instance;
  }

  initialize(context: vscode.ExtensionContext): void {
    this.context = context;

    const storagePath = context.globalStorageUri.fsPath;
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  isInitialized(): boolean {
    return Boolean(this.context);
  }

  getSecrets(): vscode.SecretStorage {
    if (!this.context) {
      throw new Error('RuntimeContextService is not initialized');
    }
    return this.context.secrets;
  }

  getGlobalStoragePath(): string {
    if (!this.context) {
      throw new Error('RuntimeContextService is not initialized');
    }
    return this.context.globalStorageUri.fsPath;
  }
}
