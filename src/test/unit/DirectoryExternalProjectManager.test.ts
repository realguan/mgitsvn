import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectoryExternalProjectManager } from '../../services/DirectoryExternalProjectManager';

test('DirectoryExternalProjectManager 根据目录 external 生成嵌套项目配置', () => {
  const project = DirectoryExternalProjectManager.buildProjectConfig({
    ownerProject: 'st_web',
    ownerProjectPath: 'st_web',
    propertyTargetUrl: 'https://svn.example.com/repos/app/trunk/st_web',
    propertyTargetRelativePath: '',
    localRelativePath: 'third_party/common',
    externalUrl: 'https://svn.example.com/repos/libs/common',
    rawLine: '^/libs/common third_party/common',
    kind: 'directory',
  });

  assert.deepEqual(project, {
    name: 'st_web:third_party/common',
    path: 'st_web/third_party/common',
    svnRemotes: {
      external: 'https://svn.example.com/repos/libs/common',
    },
    enabled: true,
    source: 'external',
    external: {
      ownerProject: 'st_web',
      localRelativePath: 'third_party/common',
      rawLine: '^/libs/common third_party/common',
      propertyTargetUrl: 'https://svn.example.com/repos/app/trunk/st_web',
    },
  });
});
