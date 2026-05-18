import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalsAutoManageStrategy } from '../../services/ExternalsAutoManageStrategy';

test('ExternalsAutoManageStrategy 在 prompt 模式下不自动执行', () => {
  const plan = ExternalsAutoManageStrategy.buildPlan({
    directoryMode: 'prompt',
    fileMode: 'prompt',
    directoryCount: 2,
    fileCount: 3,
  });

  assert.deepEqual(plan, {
    autoImportDirectories: false,
    autoApplyFiles: false,
    shouldPromptDirectories: true,
    shouldPromptFiles: true,
  });
});

test('ExternalsAutoManageStrategy 在 auto-manage/auto-link 模式下自动执行', () => {
  const plan = ExternalsAutoManageStrategy.buildPlan({
    directoryMode: 'auto-manage',
    fileMode: 'auto-link',
    directoryCount: 2,
    fileCount: 3,
  });

  assert.deepEqual(plan, {
    autoImportDirectories: true,
    autoApplyFiles: true,
    shouldPromptDirectories: false,
    shouldPromptFiles: false,
  });
});

test('ExternalsAutoManageStrategy 在 ignore 模式下跳过该类 externals', () => {
  const plan = ExternalsAutoManageStrategy.buildPlan({
    directoryMode: 'ignore',
    fileMode: 'prompt',
    directoryCount: 2,
    fileCount: 1,
  });

  assert.deepEqual(plan, {
    autoImportDirectories: false,
    autoApplyFiles: false,
    shouldPromptDirectories: false,
    shouldPromptFiles: true,
  });
});

test('ExternalsAutoManageStrategy 对数量为 0 的类型不触发动作', () => {
  const plan = ExternalsAutoManageStrategy.buildPlan({
    directoryMode: 'auto-manage',
    fileMode: 'auto-link',
    directoryCount: 0,
    fileCount: 0,
  });

  assert.deepEqual(plan, {
    autoImportDirectories: false,
    autoApplyFiles: false,
    shouldPromptDirectories: false,
    shouldPromptFiles: false,
  });
});
