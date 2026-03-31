/**
 * Logger utility for @batiste-aidk/code
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private prefix: string;
  private level: LogLevel;

  constructor(prefix: string, level: LogLevel = 'info') {
    this.prefix = prefix;
    this.level = (process.env.LOG_LEVEL as LogLevel) ?? level;
  }

  child(name: string): Logger {
    return new Logger(`${this.prefix}:${name}`, this.level);
  }

  debug(...args: unknown[]): void {
    this.log('debug', ...args);
  }

  info(...args: unknown[]): void {
    this.log('info', ...args);
  }

  warn(...args: unknown[]): void {
    this.log('warn', ...args);
  }

  error(...args: unknown[]): void {
    this.log('error', ...args);
  }

  private log(level: LogLevel, ...args: unknown[]): void {
    if (LOG_LEVELS[level] >= LOG_LEVELS[this.level]) {
      const method = level === 'debug' ? 'log' : level;
      console[method](`[${this.prefix}]`, ...args);
    }
  }
}

export const logger = new Logger('batiste');
