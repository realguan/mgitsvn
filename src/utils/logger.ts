import * as vscode from 'vscode';

class Logger {
  private outputChannel: any; // 声明为 any 以避开版本不匹配的类型报错

  constructor() {
    // VS Code 1.74+ 推荐的写法，第二个参数带 { log: true } 会创建一个支持日志级别着色的频道
    this.outputChannel = (vscode.window as any).createOutputChannel('MGitSVN', { log: true });
  }

  // 辅助方法：处理消息级别输出
  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: unknown[]): void {
    if (this.outputChannel && typeof this.outputChannel[level] === 'function') {
      this.outputChannel[level](message, ...args);
    } else {
      // 降级方案
      const timestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    this.info(`SUCCESS: ${message}`, ...args);
  }

  /**
   * 颜色工具方法 (暂时返回原样字符串，避免 ANSI 导致显示乱码)
   */
  colorize(text: string, _color: string): string {
    return text;
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}

export const logger = new Logger();
