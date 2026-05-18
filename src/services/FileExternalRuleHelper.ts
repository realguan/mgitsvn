import * as path from 'path';
import { FileExternalRule } from '../models';
import { ParsedExternalDefinition } from './SvnExternalsParser';

export interface WorkspaceFileExternalApplication {
  projectRootPath: string;
  rules: FileExternalRule[];
}

/**
 * file external 规则辅助工具
 */
export class FileExternalRuleHelper {
  static buildRule(
    definition: ParsedExternalDefinition,
    linkMode: 'symlink' | 'copy'
  ): FileExternalRule {
    return {
      ownerProject: definition.ownerProject,
      ownerProjectPath: definition.ownerProjectPath,
      localRelativePath: definition.localRelativePath,
      sourceUrl: definition.externalUrl,
      sourceRevision: definition.externalRevision,
      linkMode,
      rawLine: definition.rawLine,
      enabled: true,
    };
  }

  static mergeRules(existing: FileExternalRule[], incoming: FileExternalRule[]): FileExternalRule[] {
    const map = new Map<string, FileExternalRule>();

    for (const rule of existing) {
      map.set(this.getRuleKey(rule), rule);
    }

    for (const rule of incoming) {
      map.set(this.getRuleKey(rule), rule);
    }

    return Array.from(map.values());
  }

  static buildWorkspaceApplicationPlan(
    workspaceRoot: string,
    rules: FileExternalRule[]
  ): WorkspaceFileExternalApplication[] {
    const grouped = new Map<string, FileExternalRule[]>();

    for (const rule of rules) {
      const key = rule.ownerProjectPath;
      const existing = grouped.get(key) ?? [];
      existing.push(rule);
      grouped.set(key, existing);
    }

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ownerProjectPath, groupedRules]) => ({
        projectRootPath: path.join(workspaceRoot, ownerProjectPath),
        rules: groupedRules,
      }));
  }

  private static getRuleKey(rule: FileExternalRule): string {
    return `${rule.ownerProject}::${rule.localRelativePath}`;
  }
}
