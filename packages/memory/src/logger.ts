type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  private level: LogLevel;
  constructor(private prefix: string, level: LogLevel = 'warn') {
    this.level = (process.env.LOG_LEVEL as LogLevel) || level;
  }
  private ok(l: LogLevel) { return LEVELS[l] >= LEVELS[this.level]; }
  private fmt(l: LogLevel, m: string) { return `[${new Date().toISOString()}] [${this.prefix}] [${l.toUpperCase()}] ${m}`; }
  debug(m: string, ...a: unknown[]) { if (this.ok('debug')) console.error(this.fmt('debug', m), ...a); }
  info(m: string, ...a: unknown[]) { if (this.ok('info')) console.error(this.fmt('info', m), ...a); }
  warn(m: string, ...a: unknown[]) { if (this.ok('warn')) console.error(this.fmt('warn', m), ...a); }
  error(m: string, ...a: unknown[]) { if (this.ok('error')) console.error(this.fmt('error', m), ...a); }
  child(suffix: string) { return new Logger(`${this.prefix}:${suffix}`, this.level); }
}

export const logger = new Logger('batiste-memory');
export type { LogLevel };
