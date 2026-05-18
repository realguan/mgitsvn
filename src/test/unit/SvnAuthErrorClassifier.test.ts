import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySvnAuthError } from '../../services/SvnAuthErrorClassifier';

test('classifySvnAuthError 识别认证失败', () => {
  const result = classifySvnAuthError({
    code: 1,
    stderr: 'svn: E170001: Authorization failed',
    stdout: '',
  });

  assert.equal(result.kind, 'auth');
  assert.equal(result.shouldRetryWithCredentials, true);
  assert.equal(result.shouldFallbackToTerminal, false);
});

test('classifySvnAuthError 识别交互被禁用场景', () => {
  const result = classifySvnAuthError({
    code: 1,
    stderr: 'svn: E215004: Interactive prompting is disabled',
    stdout: '',
  });

  assert.equal(result.kind, 'auth');
  assert.equal(result.shouldRetryWithCredentials, true);
  assert.equal(result.shouldFallbackToTerminal, true);
});

test('classifySvnAuthError 识别证书校验失败', () => {
  const result = classifySvnAuthError({
    code: 1,
    stderr: 'Server certificate verification failed: issuer is not trusted',
    stdout: '',
  });

  assert.equal(result.kind, 'certificate');
  assert.equal(result.shouldRetryWithCredentials, false);
  assert.equal(result.shouldFallbackToTerminal, true);
});

test('classifySvnAuthError 对普通错误不误判', () => {
  const result = classifySvnAuthError({
    code: 1,
    stderr: 'fatal: not a git repository',
    stdout: '',
  });

  assert.equal(result.kind, 'other');
  assert.equal(result.shouldRetryWithCredentials, false);
});
