import test from 'node:test';
import assert from 'node:assert/strict';
import { SvnCredentialService } from '../../services/SvnCredentialService';

class FakeSecretStorage {
  private readonly storeMap = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.storeMap.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.storeMap.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storeMap.delete(key);
  }
}

test('SvnCredentialService 对同一主机的 URL 生成稳定作用域', () => {
  const scopeA = SvnCredentialService.normalizeCredentialScope('https://user:pass@example.com/repos/app/trunk/');
  const scopeB = SvnCredentialService.normalizeCredentialScope('https://example.com/repos/app/branches/release');

  assert.equal(scopeA, 'https://example.com');
  assert.equal(scopeA, scopeB);
});

test('SvnCredentialService 可以保存并读取凭据', async () => {
  const service = new SvnCredentialService(new FakeSecretStorage());

  await service.saveCredential('https://example.com/repos/app/trunk', {
    username: 'alice',
    password: 'secret',
    updatedAt: '2026-05-11T00:00:00.000Z',
  });

  const credential = await service.getCredential('https://example.com/repos/app/branches/release');

  assert.deepEqual(credential, {
    username: 'alice',
    password: 'secret',
    updatedAt: '2026-05-11T00:00:00.000Z',
  });
});

test('SvnCredentialService 删除凭据后不可再读取', async () => {
  const service = new SvnCredentialService(new FakeSecretStorage());

  await service.saveCredential('https://example.com/repos/app/trunk', {
    username: 'alice',
    password: 'secret',
    updatedAt: '2026-05-11T00:00:00.000Z',
  });
  await service.deleteCredential('https://example.com/repos/app/trunk');

  const credential = await service.getCredential('https://example.com/repos/app/trunk');
  assert.equal(credential, undefined);
});
