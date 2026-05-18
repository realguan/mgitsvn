import * as path from 'path';
import { GitSvnCommandRunner } from './GitSvnCommandRunner';
import { logger } from '../utils/logger';

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

export interface SvnExternalsScanResult {
  ownerProject: string;
  scannedUrl: string;
  directoryExternals: ParsedExternalDefinition[];
  fileExternals: ParsedExternalDefinition[];
  unknownExternals: ParsedExternalDefinition[];
}

export interface SvnExternalsScanInput {
  ownerProject: string;
  ownerProjectPath: string;
  scannedUrl: string;
  cwd: string;
}

interface BuildDefinitionInput {
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
 * SVN externals 扫描服务
 * 负责远端读取 svn:externals、解析定义并按目录/文件分类
 */
export class SvnExternalsService {
  private static instance: SvnExternalsService;
  private readonly commandRunner = GitSvnCommandRunner.getInstance();

  private constructor() {}

  static getInstance(): SvnExternalsService {
    if (!SvnExternalsService.instance) {
      SvnExternalsService.instance = new SvnExternalsService();
    }
    return SvnExternalsService.instance;
  }

  async scanProject(input: SvnExternalsScanInput): Promise<SvnExternalsScanResult> {
    const repoRootUrl = await this.getRepositoryRootUrl(input.scannedUrl, input.cwd);
    if (!repoRootUrl) {
      logger.warn(`Failed to resolve repository root for ${input.scannedUrl}`);
      return this.createEmptyResult(input.ownerProject, input.scannedUrl);
    }

    const propgetResult = await this.commandRunner.runSvnCommand(
      ['propget', 'svn:externals', '-R', '--xml', input.scannedUrl],
      {
        cwd: input.cwd,
        authUrl: input.scannedUrl,
        repoLabel: input.ownerProject,
        terminalTitle: `MGitSVN Scan Externals ${input.ownerProject}`,
      }
    );

    if (!propgetResult.success && !this.isPropertyMissing(propgetResult.message)) {
      logger.warn(`Failed to scan svn:externals for ${input.ownerProject}: ${propgetResult.message}`);
      return this.createEmptyResult(input.ownerProject, input.scannedUrl);
    }

    const targets = SvnExternalsService.extractExternalTargetsFromPropgetXml(propgetResult.stdout);
    if (targets.length === 0) {
      return this.createEmptyResult(input.ownerProject, input.scannedUrl);
    }

    const definitions: ParsedExternalDefinition[] = [];

    for (const target of targets) {
      const propertyTargetUrl = SvnExternalsService.resolvePropertyTargetUrl(
        input.scannedUrl,
        target.targetPath
      );
      const propertyTargetRelativePath = SvnExternalsService.relativeUrlPath(
        input.scannedUrl,
        propertyTargetUrl
      );

      const lines = target.propertyValue.split(/\r?\n/);
      for (const line of lines) {
        const parsedLine = SvnExternalsService.parseDefinitionLine(line);
        if (!parsedLine) {
          continue;
        }

        const externalUrl = SvnExternalsService.resolveExternalUrl(
          parsedLine.externalRef,
          propertyTargetUrl,
          repoRootUrl
        );
        const kind = await this.detectExternalKind(
          externalUrl,
          parsedLine.pegRevision,
          input.cwd
        );

        definitions.push(
          SvnExternalsService.buildDefinition({
            ownerProject: input.ownerProject,
            ownerProjectPath: input.ownerProjectPath,
            propertyTargetUrl,
            propertyTargetRelativePath,
            localPath: parsedLine.localPath,
            externalUrl,
            externalRevision: parsedLine.externalRevision,
            pegRevision: parsedLine.pegRevision,
            rawLine: line.trim(),
            kind,
          })
        );
      }
    }

    return {
      ownerProject: input.ownerProject,
      scannedUrl: input.scannedUrl,
      directoryExternals: definitions.filter((definition) => definition.kind === 'directory'),
      fileExternals: definitions.filter((definition) => definition.kind === 'file'),
      unknownExternals: definitions.filter((definition) => definition.kind === 'unknown'),
    };
  }

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
        targetPath: SvnExternalsService.decodeXml(match[1]),
        propertyValue: SvnExternalsService.decodeXml(propertyMatch[1]).trim(),
      });
    }

    return results;
  }

  static parseDefinitionLine(line: string): ParsedExternalLine | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return undefined;
    }

    const tokens = SvnExternalsService.tokenizeDefinitionLine(trimmed);
    if (tokens.length < 2) {
      return undefined;
    }

    const modern = SvnExternalsService.parseModernFormat(tokens);
    if (modern) {
      return modern;
    }

    return SvnExternalsService.parseLegacyFormat(tokens);
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
      return new URL(externalRef.slice(2), SvnExternalsService.ensureDirectoryUrl(repoRootUrl)).toString();
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
      SvnExternalsService.ensureDirectoryUrl(propertyTargetUrl)
    ).toString();
  }

  static buildDefinition(input: BuildDefinitionInput): ParsedExternalDefinition {
    const localRelativePath = SvnExternalsService.joinRelativePath(
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

    return new URL(targetPath, SvnExternalsService.ensureDirectoryUrl(scannedUrl)).toString();
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

  private async detectExternalKind(
    externalUrl: string,
    pegRevision: string | undefined,
    cwd: string
  ): Promise<SvnExternalDefinitionKind> {
    const targetForInfo = pegRevision ? `${externalUrl}@${pegRevision}` : externalUrl;
    const result = await this.commandRunner.runSvnCommand(
      ['info', '--show-item', 'kind', targetForInfo],
      {
        cwd,
        authUrl: externalUrl,
        repoLabel: 'externals-kind',
        terminalTitle: 'MGitSVN External Kind',
      }
    );

    if (!result.success) {
      return 'unknown';
    }

    const kind = result.stdout.trim().toLowerCase();
    if (kind === 'dir') {
      return 'directory';
    }
    if (kind === 'file') {
      return 'file';
    }
    return 'unknown';
  }

  private async getRepositoryRootUrl(scannedUrl: string, cwd: string): Promise<string | undefined> {
    const result = await this.commandRunner.runSvnCommand(
      ['info', '--show-item', 'repos-root-url', scannedUrl],
      {
        cwd,
        authUrl: scannedUrl,
        repoLabel: 'externals-root',
        terminalTitle: 'MGitSVN Resolve Repo Root',
      }
    );

    if (!result.success) {
      return undefined;
    }

    return result.stdout.trim();
  }

  private isPropertyMissing(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('w200017') || normalized.includes('property') && normalized.includes('not found');
  }

  private createEmptyResult(ownerProject: string, scannedUrl: string): SvnExternalsScanResult {
    return {
      ownerProject,
      scannedUrl,
      directoryExternals: [],
      fileExternals: [],
      unknownExternals: [],
    };
  }

  private static parseModernFormat(tokens: string[]): ParsedExternalLine | undefined {
    const { nextIndex, revision } = SvnExternalsService.consumeRevision(tokens, 0);
    if (nextIndex >= tokens.length - 1) {
      return undefined;
    }

    const urlToken = tokens[nextIndex];
    if (!SvnExternalsService.looksLikeUrl(urlToken)) {
      return undefined;
    }

    const localPath = tokens[nextIndex + 1];
    return SvnExternalsService.finalizeParsedLine(localPath, urlToken, revision);
  }

  private static parseLegacyFormat(tokens: string[]): ParsedExternalLine | undefined {
    const localPath = tokens[0];
    if (SvnExternalsService.looksLikeUrl(localPath)) {
      return undefined;
    }

    const { nextIndex, revision } = SvnExternalsService.consumeRevision(tokens, 1);
    if (nextIndex >= tokens.length) {
      return undefined;
    }

    const urlToken = tokens[nextIndex];
    if (!SvnExternalsService.looksLikeUrl(urlToken)) {
      return undefined;
    }

    return SvnExternalsService.finalizeParsedLine(localPath, urlToken, revision);
  }

  private static finalizeParsedLine(
    localPath: string,
    externalRefWithPeg: string,
    revision?: string
  ): ParsedExternalLine {
    const { externalRef, pegRevision } = SvnExternalsService.extractPegRevision(
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
