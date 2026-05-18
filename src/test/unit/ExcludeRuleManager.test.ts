import test from 'node:test';
import assert from 'node:assert/strict';
import { ExcludeRuleManager } from '../../services/ExcludeRuleManager';

test('ExcludeRuleManager 合并规则时保留原内容并去重', () => {
  const merged = ExcludeRuleManager.mergeExcludeContent(
    ['node_modules', 'dist', 'third_party/common'],
    ['third_party/common', 'generated/assets']
  );

  assert.deepEqual(merged, [
    'node_modules',
    'dist',
    'third_party/common',
    'generated/assets',
  ]);
});
