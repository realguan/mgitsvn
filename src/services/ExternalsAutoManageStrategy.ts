export interface ExternalsAutoManageInput {
  directoryMode: 'prompt' | 'auto-manage' | 'ignore';
  fileMode: 'prompt' | 'auto-link' | 'ignore';
  directoryCount: number;
  fileCount: number;
}

export interface ExternalsAutoManagePlan {
  autoImportDirectories: boolean;
  autoApplyFiles: boolean;
  shouldPromptDirectories: boolean;
  shouldPromptFiles: boolean;
}

/**
 * externals 自动纳管策略
 */
export class ExternalsAutoManageStrategy {
  static buildPlan(input: ExternalsAutoManageInput): ExternalsAutoManagePlan {
    const hasDirectories = input.directoryCount > 0;
    const hasFiles = input.fileCount > 0;

    return {
      autoImportDirectories: hasDirectories && input.directoryMode === 'auto-manage',
      autoApplyFiles: hasFiles && input.fileMode === 'auto-link',
      shouldPromptDirectories: hasDirectories && input.directoryMode === 'prompt',
      shouldPromptFiles: hasFiles && input.fileMode === 'prompt',
    };
  }
}
