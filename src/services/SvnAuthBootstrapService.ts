import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RuntimeContextService } from './RuntimeContextService';
import { SvnStoredCredential } from '../models';
import { logger } from '../utils/logger';

export interface SvnBootstrapResult {
  success: boolean;
  message: string;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * SVN 认证预热服务
 * 使用 svn info + 独立 config-dir 预热 SVN auth cache
 */
export class SvnAuthBootstrapService {
  private static instance: SvnAuthBootstrapService;

  private constructor() {}

  static getInstance(): SvnAuthBootstrapService {
    if (!SvnAuthBootstrapService.instance) {
      SvnAuthBootstrapService.instance = new SvnAuthBootstrapService();
    }
    return SvnAuthBootstrapService.instance;
  }

  getManagedConfigDir(): string {
    const storagePath = RuntimeContextService.getInstance().getGlobalStoragePath();
    const configDir = path.join(storagePath, 'svn-auth');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return configDir;
  }

  async bootstrap(rawUrl: string, credential: SvnStoredCredential): Promise<SvnBootstrapResult> {
    return new Promise((resolve) => {
      const args = [
        'info',
        rawUrl,
        '--non-interactive',
        '--username',
        credential.username,
        '--password-from-stdin',
        '--config-dir',
        this.getManagedConfigDir(),
      ];

      logger.info(`Bootstrapping SVN auth cache for ${SvnAuthBootstrapService.maskUrl(rawUrl)}`);

      const proc = spawn('svn', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const success = code === 0;
        resolve({
          success,
          message: success ? 'SVN auth cache bootstrap completed' : stderr || stdout || 'SVN auth cache bootstrap failed',
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

      proc.stdin.write(`${credential.password}\n`);
      proc.stdin.end();
    });
  }

  static maskUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return rawUrl.replace(/\/\/[^@/]+@/, '//');
    }
  }
}
