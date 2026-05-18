import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtensionId, buildMarketplaceItemUrl } from '../../utils/marketplace';

test('buildExtensionId 生成完整扩展 ID', () => {
  const extensionId = buildExtensionId('realguan', 'mgitsvn');
  assert.equal(extensionId, 'realguan.mgitsvn');
});

test('buildMarketplaceItemUrl 生成插件市场详情页地址', () => {
  const url = buildMarketplaceItemUrl('realguan', 'mgitsvn');
  assert.equal(url, 'https://marketplace.visualstudio.com/items?itemName=realguan.mgitsvn');
});
