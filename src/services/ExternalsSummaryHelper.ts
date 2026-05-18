import { SvnExternalsScanResult } from './SvnExternalsService';

export interface ExternalsSummary {
  directoryCount: number;
  fileCount: number;
  unknownCount: number;
  hasDirectoryActions: boolean;
  hasFileActions: boolean;
  hasAny: boolean;
}

/**
 * externals 摘要辅助工具
 */
export class ExternalsSummaryHelper {
  static summarize(results: SvnExternalsScanResult[]): ExternalsSummary {
    const directoryCount = results.reduce((sum, item) => sum + item.directoryExternals.length, 0);
    const fileCount = results.reduce((sum, item) => sum + item.fileExternals.length, 0);
    const unknownCount = results.reduce((sum, item) => sum + item.unknownExternals.length, 0);

    return {
      directoryCount,
      fileCount,
      unknownCount,
      hasDirectoryActions: directoryCount > 0,
      hasFileActions: fileCount > 0,
      hasAny: directoryCount > 0 || fileCount > 0 || unknownCount > 0,
    };
  }
}
