/**
 * 构造扩展完整 ID
 */
export function buildExtensionId(publisher: string, extensionName: string): string {
  return `${publisher}.${extensionName}`;
}

/**
 * 构造 VS Code Marketplace 详情页地址
 */
export function buildMarketplaceItemUrl(publisher: string, extensionName: string): string {
  return `https://marketplace.visualstudio.com/items?itemName=${buildExtensionId(publisher, extensionName)}`;
}
