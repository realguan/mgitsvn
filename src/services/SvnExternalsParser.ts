import * as path from 'path';

export type SvnExternalDefinitionKind = 'directory' | 'file' | 'unknown';

export interface SvnExternalTargetEntry {
  targetPath: string;
  propertyValue: string;
}

export interface ParsedExternalLine {
  localPath: string;
  externalRef: string;
  externalRevision?: string;
  pegRevision?: string;
}

export interface ParsedExternalDefinition {
  ownerProject: string;
  ownerProjectPath: string;
  propertyTargetUrl: string;
  propertyTargetRelativePath: string;
  localRelativePath: string;
  externalUrl: string;
  externalRevision?: string;
  pegRevision?: string;
  rawLine: string;
  kind: SvnExternalDefinitionKind;
}

export interface BuildDefinitionInput {
  ownerProject: string;
  ownerProjectPath: string;
  propertyTargetUrl: string;
  propertyTargetRelativePath: string;
  localPath: string;
  externalUrl: string;
  externalRevision?: string;
  pegRevision?: string;
  rawLine: string;
  kind: SvnExternalDefinitionKind;
}

/**
 * SVN externals 纯解析工具
 * 不依赖 VS Code 运行时，适合单元测试
 */
export class SvnExternalsParser {
  static extractExternalTargetsFromPropgetXml(xml: string): SvnExternalTargetEntry[] {
    if (!xml.trim()) {
      return [];
    }

    const targetRegex = /<target\b[^>]*path="([^"]*)"[^>]*>([\s\S]*?)<\/target>/g;
    const propertyRegex = /<property\b[^>]*name="svn:externals"[^>]*>([\s\S]*?)<\/property>/;
    const results: SvnExternalTargetEntry[] = [];

    let match: RegExpExecArray | null;
    while ((match = targetRegex.exec(xml)) !== null) {
      const propertyMatch = propertyRegex.exec(match[2]);
      if (!propertyMatch) {
        continue;
      }

      results.push({
        targetPath: SvnExternalsParser.decodeXml(match[1]),
        propertyValue: SvnExternalsParser.decodeXml(propertyMatch[1]).trim(),
      });
    }

    return results;
  }

  static parseDefinitionLine(line: string): ParsedExternalLine | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return undefined;
    }

    const tokens = SvnExternalsParser.tokenizeDefinitionLine(trimmed);
    if (tokens.length < 2) {
      return undefined;
    }

    const modern = SvnExternalsParser.parseModernFormat(tokens);
    if (modern) {
      return modern;
    }

    return SvnExternalsParser.parseLegacyFormat(tokens);
  }

  static resolveExternalUrl(
    externalRef: string,
    propertyTargetUrl: string,
    repoRootUrl: string
  ): string {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(externalRef)) {
      return externalRef;
    }

    if (externalRef.startsWith('^/')) {
      return new URL(externalRef.slice(2), SvnExternalsParser.ensureDirectoryUrl(repoRootUrl)).toString();
    }

    if (externalRef.startsWith('//')) {
      const propertyUrl = new URL(propertyTargetUrl);
      return `${propertyUrl.protocol}${externalRef}`;
    }

    if (externalRef.startsWith('/')) {
      const propertyUrl = new URL(propertyTargetUrl);
      return `${propertyUrl.origin}${externalRef}`;
    }

    return new URL(
      externalRef,
      SvnExternalsParser.ensureDirectoryUrl(propertyTargetUrl)
    ).toString();
  }

  static buildDefinition(input: BuildDefinitionInput): ParsedExternalDefinition {
    const localRelativePath = SvnExternalsParser.joinRelativePath(
      input.propertyTargetRelativePath,
      input.localPath
    );

    return {
      ownerProject: input.ownerProject,
      ownerProjectPath: input.ownerProjectPath,
      propertyTargetUrl: input.propertyTargetUrl,
      propertyTargetRelativePath: input.propertyTargetRelativePath,
      localRelativePath,
      externalUrl: input.externalUrl,
      externalRevision: input.externalRevision,
      pegRevision: input.pegRevision,
      rawLine: input.rawLine,
      kind: input.kind,
    };
  }

  static resolvePropertyTargetUrl(scannedUrl: string, targetPath: string): string {
    if (!targetPath || targetPath === '.' || targetPath === scannedUrl) {
      return scannedUrl;
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(targetPath)) {
      return targetPath;
    }

    return new URL(targetPath, SvnExternalsParser.ensureDirectoryUrl(scannedUrl)).toString();
  }

  static relativeUrlPath(baseUrl: string, targetUrl: string): string {
    const base = new URL(baseUrl);
    const target = new URL(targetUrl);

    const relative = path.posix.relative(base.pathname, target.pathname);
    if (!relative || relative === '.') {
      return '';
    }

    return relative.replace(/^\/+/, '');
  }

  private static parseModernFormat(tokens: string[]): ParsedExternalLine | undefined {
    const { nextIndex, revision } = SvnExternalsParser.consumeRevision(tokens, 0);
    if (nextIndex >= tokens.length - 1) {
      return undefined;
    }

    const urlToken = tokens[nextIndex];
    if (!SvnExternalsParser.looksLikeUrl(urlToken)) {
      return undefined;
    }

    const localPath = tokens[nextIndex + 1];
    return SvnExternalsParser.finalizeParsedLine(localPath, urlToken, revision);
  }

  private static parseLegacyFormat(tokens: string[]): ParsedExternalLine | undefined {
    const localPath = tokens[0];
    if (SvnExternalsParser.looksLikeUrl(localPath)) {
      return undefined;
    }

    const { nextIndex, revision } = SvnExternalsParser.consumeRevision(tokens, 1);
    if (nextIndex >= tokens.length) {
      return undefined;
    }

    const urlToken = tokens[nextIndex];
    if (!SvnExternalsParser.looksLikeUrl(urlToken)) {
      return undefined;
    }

    return SvnExternalsParser.finalizeParsedLine(localPath, urlToken, revision);
  }

  private static finalizeParsedLine(
    localPath: string,
    externalRefWithPeg: string,
    revision?: string
  ): ParsedExternalLine {
    const { externalRef, pegRevision } = SvnExternalsParser.extractPegRevision(
      externalRefWithPeg
    );

    return {
      localPath,
      externalRef,
      externalRevision: revision,
      pegRevision,
    };
  }

  private static consumeRevision(
    tokens: string[],
    startIndex: number
  ): { nextIndex: number; revision?: string } {
    if (startIndex >= tokens.length) {
      return { nextIndex: startIndex };
    }

    const token = tokens[startIndex];
    if (token === '-r' && startIndex + 1 < tokens.length) {
      return {
        nextIndex: startIndex + 2,
        revision: tokens[startIndex + 1],
      };
    }

    if (token.startsWith('-r') && token.length > 2) {
      return {
        nextIndex: startIndex + 1,
        revision: token.slice(2),
      };
    }

    return { nextIndex: startIndex };
  }

  private static extractPegRevision(externalRefWithPeg: string): {
    externalRef: string;
    pegRevision?: string;
  } {
    const lastAt = externalRefWithPeg.lastIndexOf('@');
    const lastSlash = externalRefWithPeg.lastIndexOf('/');

    if (lastAt === -1 || lastAt < lastSlash) {
      return { externalRef: externalRefWithPeg };
    }

    const revision = externalRefWithPeg.slice(lastAt + 1);
    if (!/^(?:\d+|HEAD)$/i.test(revision)) {
      return { externalRef: externalRefWithPeg };
    }

    return {
      externalRef: externalRefWithPeg.slice(0, lastAt),
      pegRevision: revision,
    };
  }

  private static tokenizeDefinitionLine(line: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | '' = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '\\' && i + 1 < line.length) {
        current += line[i + 1];
        i++;
        continue;
      }

      if ((char === '"' || char === "'") && !quote) {
        quote = char;
        continue;
      }

      if (char === quote) {
        quote = '';
        continue;
      }

      if (/\s/.test(char) && !quote) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  private static looksLikeUrl(value: string): boolean {
    return /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|\^\/|\/|\.{1,2}\/)/.test(value);
  }

  private static joinRelativePath(basePath: string, localPath: string): string {
    if (!basePath) {
      return localPath.replace(/^\/+/, '');
    }
    return path.posix.join(basePath, localPath).replace(/^\/+/, '');
  }

  private static ensureDirectoryUrl(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private static decodeXml(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
}
