import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { FileExternalRule } from '../models';
import { FileExternalRuleHelper } from './FileExternalRuleHelper';
import { GitSvnCommandRunner } from './GitSvnCommandRunner';
import { RuntimeContextService } from './RuntimeContextService';

/**
 * file external 落地管理器
 * 负责 svn export 到缓存目录，并在项目中创建软链接或复制文件
 */
export class FileExternalLinkManager {
  private readonly commandRunner = GitSvnCommandRunner.getInstance();

  async applyRules(projectRootPath: string, rules: FileExternalRule[]): Promise<void> {
    for (const rule of rules) {
      if (!rule.enabled) {
        continue;
      }

      const cachePath = await this.prepareCacheFile(rule, projectRootPath);
      const targetPath = path.join(projectRootPath, rule.localRelativePath);
      const targetDir = path.dirname(targetPath);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      this.removeTargetIfExists(targetPath);
      if (rule.linkMode === 'symlink') {
        fs.symlinkSync(cachePath, targetPath);
      } else {
        fs.copyFileSync(cachePath, targetPath);
      }
    }
  }

  async applyRulesInWorkspace(workspaceRoot: string, rules: FileExternalRule[]): Promise<void> {
    const plan = FileExternalRuleHelper.buildWorkspaceApplicationPlan(workspaceRoot, rules);
    for (const item of plan) {
      if (!fs.existsSync(item.projectRootPath)) {
        continue;
      }
      await this.applyRules(item.projectRootPath, item.rules);
    }
  }

  private async prepareCacheFile(rule: FileExternalRule, cwd: string): Promise<string> {
    const cacheDir = path.join(
      RuntimeContextService.getInstance().getGlobalStoragePath(),
      'externals-cache'
    );
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFilePath = path.join(
      cacheDir,
      this.buildCacheFileName(rule)
    );

    const args = ['export', rule.sourceUrl, cacheFilePath, '--force'];
    if (rule.sourceRevision) {
      args.push('-r', rule.sourceRevision);
    }

    const result = await this.commandRunner.runSvnCommand(args, {
      cwd,
      authUrl: rule.sourceUrl,
      repoLabel: `${rule.ownerProject}:${rule.localRelativePath}`,
      terminalTitle: 'MGitSVN Apply File External',
    });

    if (!result.success) {
      throw new Error(result.message);
    }

    return cacheFilePath;
  }

  private buildCacheFileName(rule: FileExternalRule): string {
    const hash = crypto
      .createHash('sha1')
      .update(`${rule.sourceUrl}|${rule.sourceRevision ?? ''}`)
      .digest('hex');

    const ext = path.extname(rule.localRelativePath);
    return `${hash}${ext}`;
  }

  private removeTargetIfExists(targetPath: string): void {
    try {
      const stat = fs.lstatSync(targetPath);
      if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
    } catch {
      // ignore if target does not exist
    }
  }
}
