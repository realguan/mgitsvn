import test from 'node:test';
import assert from 'node:assert/strict';
import { FileExternalRuleHelper } from '../../services/FileExternalRuleHelper';

test('FileExternalRuleHelper 根据 file external 生成规则', () => {
  const rule = FileExternalRuleHelper.buildRule({
    ownerProject: 'st_web',
    ownerProjectPath: 'st_web',
    propertyTargetUrl: 'https://svn.example.com/repos/app/trunk/st_web/www',
    propertyTargetRelativePath: 'www',
    localRelativePath: 'www/logo.svg',
    externalUrl: 'https://svn.example.com/repos/app/trunk/assets/logo.svg',
    externalRevision: '123',
    pegRevision: '40',
    rawLine: '-r123 ^/trunk/assets/logo.svg@40 logo.svg',
    kind: 'file',
  }, 'symlink');

  assert.deepEqual(rule, {
    ownerProject: 'st_web',
    ownerProjectPath: 'st_web',
    localRelativePath: 'www/logo.svg',
    sourceUrl: 'https://svn.example.com/repos/app/trunk/assets/logo.svg',
    sourceRevision: '123',
    linkMode: 'symlink',
    rawLine: '-r123 ^/trunk/assets/logo.svg@40 logo.svg',
    enabled: true,
  });
});

test('FileExternalRuleHelper 合并规则时同路径后者覆盖前者', () => {
  const merged = FileExternalRuleHelper.mergeRules(
    [
      {
        ownerProject: 'st_web',
        ownerProjectPath: 'st_web',
        localRelativePath: 'www/logo.svg',
        sourceUrl: 'https://old/logo.svg',
        sourceRevision: undefined,
        linkMode: 'copy',
        rawLine: 'old',
        enabled: true,
      },
    ],
    [
      {
        ownerProject: 'st_web',
        ownerProjectPath: 'st_web',
        localRelativePath: 'www/logo.svg',
        sourceUrl: 'https://new/logo.svg',
        sourceRevision: '88',
        linkMode: 'symlink',
        rawLine: 'new',
        enabled: true,
      },
    ]
  );

  assert.deepEqual(merged, [
    {
      ownerProject: 'st_web',
      ownerProjectPath: 'st_web',
      localRelativePath: 'www/logo.svg',
      sourceUrl: 'https://new/logo.svg',
      sourceRevision: '88',
      linkMode: 'symlink',
      rawLine: 'new',
      enabled: true,
    },
  ]);
});
