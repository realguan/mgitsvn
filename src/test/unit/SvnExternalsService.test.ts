import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SvnExternalsParser,
  SvnExternalDefinitionKind,
} from '../../services/SvnExternalsParser';

test('SvnExternalsService 提取 propget xml 中的 externals target', () => {
  const xml = `<?xml version="1.0"?>
<properties>
  <target path="https://svn.example.com/repos/app/trunk">
    <property name="svn:externals">^/libs/common third_party/common</property>
  </target>
  <target path="https://svn.example.com/repos/app/trunk/www">
    <property name="svn:externals">^/trunk/assets/logo.svg@40 logo.svg</property>
  </target>
</properties>`;

  const targets = SvnExternalsParser.extractExternalTargetsFromPropgetXml(xml);

  assert.deepEqual(targets, [
    {
      targetPath: 'https://svn.example.com/repos/app/trunk',
      propertyValue: '^/libs/common third_party/common',
    },
    {
      targetPath: 'https://svn.example.com/repos/app/trunk/www',
      propertyValue: '^/trunk/assets/logo.svg@40 logo.svg',
    },
  ]);
});

test('SvnExternalsService 解析新格式 externals 定义', () => {
  const parsed = SvnExternalsParser.parseDefinitionLine(
    '-r148 https://svn.example.com/skinproj third-party/skins'
  );

  assert.deepEqual(parsed, {
    localPath: 'third-party/skins',
    externalRef: 'https://svn.example.com/skinproj',
    externalRevision: '148',
    pegRevision: undefined,
  });
});

test('SvnExternalsService 解析旧格式 externals 定义', () => {
  const parsed = SvnExternalsParser.parseDefinitionLine(
    'third-party/skins -r148 https://svn.example.com/skinproj'
  );

  assert.deepEqual(parsed, {
    localPath: 'third-party/skins',
    externalRef: 'https://svn.example.com/skinproj',
    externalRevision: '148',
    pegRevision: undefined,
  });
});

test('SvnExternalsService 解析文件 external 的 peg revision', () => {
  const parsed = SvnExternalsParser.parseDefinitionLine(
    '^/trunk/bikeshed/blue.html@40 green.html'
  );

  assert.deepEqual(parsed, {
    localPath: 'green.html',
    externalRef: '^/trunk/bikeshed/blue.html',
    externalRevision: undefined,
    pegRevision: '40',
  });
});

test('SvnExternalsService 归一化 ^/ 相对 URL', () => {
  const resolved = SvnExternalsParser.resolveExternalUrl(
    '^/libs/common',
    'https://svn.example.com/repos/app/trunk/module',
    'https://svn.example.com/repos/app'
  );

  assert.equal(resolved, 'https://svn.example.com/repos/app/libs/common');
});

test('SvnExternalsService 归一化 ../ 相对 URL', () => {
  const resolved = SvnExternalsParser.resolveExternalUrl(
    '../shared/config',
    'https://svn.example.com/repos/app/trunk/module/www',
    'https://svn.example.com/repos/app'
  );

  assert.equal(resolved, 'https://svn.example.com/repos/app/trunk/module/shared/config');
});

test('SvnExternalsService 计算最终挂载路径并保留 kind', () => {
  const definition = SvnExternalsParser.buildDefinition({
    ownerProject: 'app',
    ownerProjectPath: 'app',
    propertyTargetUrl: 'https://svn.example.com/repos/app/trunk/www',
    propertyTargetRelativePath: 'www',
    localPath: 'logo.svg',
    externalUrl: 'https://svn.example.com/repos/app/trunk/assets/logo.svg',
    rawLine: '^/trunk/assets/logo.svg@40 logo.svg',
    kind: 'file',
    externalRevision: undefined,
    pegRevision: '40',
  });

  assert.equal(definition.localRelativePath, 'www/logo.svg');
  assert.equal(definition.kind, 'file' satisfies SvnExternalDefinitionKind);
});
