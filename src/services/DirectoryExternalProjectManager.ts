import * as path from 'path';
import { ProjectConfig } from '../models';
import { ParsedExternalDefinition } from './SvnExternalsParser';

/**
 * 目录 external 项目转换器
 * 将解析出的 directory external 转为可纳入 projects 的配置项
 */
export class DirectoryExternalProjectManager {
  static buildProjectConfig(definition: ParsedExternalDefinition): ProjectConfig {
    return {
      name: `${definition.ownerProject}:${definition.localRelativePath}`,
      path: path.posix.join(definition.ownerProjectPath, definition.localRelativePath),
      svnRemotes: {
        external: definition.externalUrl,
      },
      enabled: true,
      source: 'external',
      external: {
        ownerProject: definition.ownerProject,
        localRelativePath: definition.localRelativePath,
        rawLine: definition.rawLine,
        propertyTargetUrl: definition.propertyTargetUrl,
      },
    };
  }
}
