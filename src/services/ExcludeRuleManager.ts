import * as fs from 'fs';
import * as path from 'path';

/**
 * Git exclude 规则管理器
 * 用于给父仓库写入 external 路径，避免状态被未跟踪目录污染
 */
export class ExcludeRuleManager {
  static mergeExcludeContent(existing: string[], additionalRules: string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const rule of [...existing, ...additionalRules]) {
      const normalized = rule.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }

    return merged;
  }

  async ensureRules(repoPath: string, relativePaths: string[]): Promise<void> {
    const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
    const excludeDir = path.dirname(excludePath);

    if (!fs.existsSync(excludeDir)) {
      fs.mkdirSync(excludeDir, { recursive: true });
    }

    const existingLines = fs.existsSync(excludePath)
      ? fs
          .readFileSync(excludePath, 'utf-8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '')
      : [];

    const merged = ExcludeRuleManager.mergeExcludeContent(existingLines, relativePaths);
    fs.writeFileSync(excludePath, `${merged.join('\n')}\n`, 'utf-8');
  }
}
