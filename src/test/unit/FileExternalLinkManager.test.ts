import test from 'node:test';
import assert from 'node:assert/strict';
import { FileExternalRuleHelper } from '../../services/FileExternalRuleHelper';

test('FileExternalLinkManager 按 ownerProjectPath 构建工作区应用计划', () => {
  const plan = FileExternalRuleHelper.buildWorkspaceApplicationPlan('/tmp/ws_feature_login', [
    {
      ownerProject: 'st_web',
      ownerProjectPath: 'st_web',
      localRelativePath: 'www/logo.svg',
      sourceUrl: 'https://example.com/logo.svg',
      sourceRevision: undefined,
      linkMode: 'symlink',
      rawLine: 'logo',
      enabled: true,
    },
    {
      ownerProject: 'st_web',
      ownerProjectPath: 'st_web',
      localRelativePath: 'www/config.json',
      sourceUrl: 'https://example.com/config.json',
      sourceRevision: undefined,
      linkMode: 'copy',
      rawLine: 'config',
      enabled: true,
    },
    {
      ownerProject: 'st_web:third_party/common',
      ownerProjectPath: 'st_web/third_party/common',
      localRelativePath: 'assets/a.txt',
      sourceUrl: 'https://example.com/a.txt',
      sourceRevision: '18',
      linkMode: 'copy',
      rawLine: 'nested',
      enabled: true,
    },
  ]);

  assert.deepEqual(plan, [
    {
      projectRootPath: '/tmp/ws_feature_login/st_web',
      rules: [
        {
          ownerProject: 'st_web',
          ownerProjectPath: 'st_web',
          localRelativePath: 'www/logo.svg',
          sourceUrl: 'https://example.com/logo.svg',
          sourceRevision: undefined,
          linkMode: 'symlink',
          rawLine: 'logo',
          enabled: true,
        },
        {
          ownerProject: 'st_web',
          ownerProjectPath: 'st_web',
          localRelativePath: 'www/config.json',
          sourceUrl: 'https://example.com/config.json',
          sourceRevision: undefined,
          linkMode: 'copy',
          rawLine: 'config',
          enabled: true,
        },
      ],
    },
    {
      projectRootPath: '/tmp/ws_feature_login/st_web/third_party/common',
      rules: [
        {
          ownerProject: 'st_web:third_party/common',
          ownerProjectPath: 'st_web/third_party/common',
          localRelativePath: 'assets/a.txt',
          sourceUrl: 'https://example.com/a.txt',
          sourceRevision: '18',
          linkMode: 'copy',
          rawLine: 'nested',
          enabled: true,
        },
      ],
    },
  ]);
});
