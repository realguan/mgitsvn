export interface SvnCommandFailure {
  code: number | null;
  stderr: string;
  stdout: string;
}

export interface SvnAuthErrorClassification {
  kind: 'auth' | 'certificate' | 'other';
  shouldRetryWithCredentials: boolean;
  shouldFallbackToTerminal: boolean;
}

const AUTH_PATTERNS = [
  'authorization failed',
  'authentication failed',
  'e170001',
  'e215004',
  'interactive prompting is disabled',
];

const CERTIFICATE_PATTERNS = [
  'server certificate verification failed',
  'certificate verification failed',
  'issuer is not trusted',
];

/**
 * 认证错误分类器
 * 用于决定是否需要凭据重试或终端回退
 */
export function classifySvnAuthError(
  failure: SvnCommandFailure
): SvnAuthErrorClassification {
  const content = `${failure.stderr}\n${failure.stdout}`.toLowerCase();

  if (CERTIFICATE_PATTERNS.some((pattern) => content.includes(pattern))) {
    return {
      kind: 'certificate',
      shouldRetryWithCredentials: false,
      shouldFallbackToTerminal: true,
    };
  }

  if (AUTH_PATTERNS.some((pattern) => content.includes(pattern))) {
    return {
      kind: 'auth',
      shouldRetryWithCredentials: true,
      shouldFallbackToTerminal: content.includes('interactive prompting is disabled'),
    };
  }

  return {
    kind: 'other',
    shouldRetryWithCredentials: false,
    shouldFallbackToTerminal: false,
  };
}
