import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalsSummaryHelper } from '../../services/ExternalsSummaryHelper';

test('ExternalsSummaryHelper 汇总目录、文件和未知数量', () => {
  const summary = ExternalsSummaryHelper.summarize([
    {
      ownerProject: 'a',
      scannedUrl: 'https://example.com/a',
      directoryExternals: [{ kind: 'directory' } as any, { kind: 'directory' } as any],
      fileExternals: [{ kind: 'file' } as any],
      unknownExternals: [],
    },
    {
      ownerProject: 'b',
      scannedUrl: 'https://example.com/b',
      directoryExternals: [],
      fileExternals: [],
      unknownExternals: [{ kind: 'unknown' } as any],
    },
  ]);

  assert.deepEqual(summary, {
    directoryCount: 2,
    fileCount: 1,
    unknownCount: 1,
    hasDirectoryActions: true,
    hasFileActions: true,
    hasAny: true,
  });
});

test('ExternalsSummaryHelper 对空结果返回无动作摘要', () => {
  const summary = ExternalsSummaryHelper.summarize([]);

  assert.deepEqual(summary, {
    directoryCount: 0,
    fileCount: 0,
    unknownCount: 0,
    hasDirectoryActions: false,
    hasFileActions: false,
    hasAny: false,
  });
});
