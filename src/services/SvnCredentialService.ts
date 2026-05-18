import { RuntimeContextService } from './RuntimeContextService';
import { SvnStoredCredential } from '../models';

const SECRET_KEY_PREFIX = 'mgitsvn:svn-credential:';

interface SecretStorageLike {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

/**
 * SVN 凭据服务
 * 通过 VS Code SecretStorage 安全保存用户名密码
 */
export class SvnCredentialService {
  private storage: SecretStorageLike;

  constructor(storage?: SecretStorageLike) {
    this.storage = storage ?? RuntimeContextService.getInstance().getSecrets();
  }

  static normalizeCredentialScope(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.host) {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // ignore
    }

    return rawUrl
      .replace(/\/\/[^@/]+@/, '//')
      .replace(/\/+$/, '');
  }

  private getStorageKey(rawUrl: string): string {
    return `${SECRET_KEY_PREFIX}${SvnCredentialService.normalizeCredentialScope(rawUrl)}`;
  }

  async getCredential(rawUrl: string): Promise<SvnStoredCredential | undefined> {
    const raw = await this.storage.get(this.getStorageKey(rawUrl));
    if (!raw) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as SvnStoredCredential;
    } catch {
      return undefined;
    }
  }

  async saveCredential(rawUrl: string, credential: SvnStoredCredential): Promise<void> {
    await this.storage.store(this.getStorageKey(rawUrl), JSON.stringify(credential));
  }

  async deleteCredential(rawUrl: string): Promise<void> {
    await this.storage.delete(this.getStorageKey(rawUrl));
  }
}
