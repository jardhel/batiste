/**
 * Terminal output — ANSI helpers, structured printing.
 *
 * Inlined to keep `@batiste-aidk/atrium` free of internal-cross-package
 * dependencies on `@batiste-aidk/cli` (which is the operator-facing
 * marketplace/node CLI, a separate concern from the FM operator CLI).
 */

const ESC = '\x1b[';

export const ansi = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  green: `${ESC}32m`,
  red: `${ESC}31m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  magenta: `${ESC}35m`,
  white: `${ESC}97m`,
  gray: `${ESC}90m`,
};

export const green = (s: string): string => `${ansi.green}${s}${ansi.reset}`;
export const red = (s: string): string => `${ansi.red}${s}${ansi.reset}`;
export const yellow = (s: string): string => `${ansi.yellow}${s}${ansi.reset}`;
export const cyan = (s: string): string => `${ansi.cyan}${s}${ansi.reset}`;
export const magenta = (s: string): string => `${ansi.magenta}${s}${ansi.reset}`;
export const gray = (s: string): string => `${ansi.gray}${s}${ansi.reset}`;
export const bold = (s: string): string => `${ansi.bold}${s}${ansi.reset}`;
export const dim = (s: string): string => `${ansi.dim}${s}${ansi.reset}`;

export function ok(msg: string): void {
  process.stdout.write(`${green('✓')} ${msg}\n`);
}
export function fail(msg: string): void {
  process.stderr.write(`${red('✗')} ${msg}\n`);
}
export function info(msg: string): void {
  process.stdout.write(`${cyan('›')} ${msg}\n`);
}
export function warn(msg: string): void {
  process.stderr.write(`${yellow('!')} ${msg}\n`);
}
export function note(msg: string): void {
  process.stdout.write(`  ${gray(msg)}\n`);
}
export function section(title: string): void {
  process.stdout.write(`\n${bold(title)}\n${gray('─'.repeat(title.length))}\n`);
}
export function kv(key: string, value: string, pad = 22): void {
  process.stdout.write(`  ${gray(key.padEnd(pad))} ${value}\n`);
}
export function br(): void {
  process.stdout.write('\n');
}

/**
 * Lightweight, ANSI-only progress bar that rewrites the same line.
 * Use for ingestion loops; falls back to periodic line writes when
 * stdout is not a TTY (so logs in CI / pipes stay readable).
 */
export class Progress {
  private startedAt = Date.now();
  private lastWrite = 0;
  private isTty = process.stdout.isTTY === true;
  constructor(private label: string, private total: number) {}

  tick(done: number, suffix = ''): void {
    const now = Date.now();
    if (now - this.lastWrite < 80 && done < this.total) return;
    this.lastWrite = now;
    const pct = this.total > 0 ? Math.min(1, done / this.total) : 0;
    const width = 24;
    const filled = Math.round(pct * width);
    const bar = green('█'.repeat(filled)) + gray('░'.repeat(width - filled));
    const rate = (done / Math.max(1, (now - this.startedAt) / 1000)).toFixed(1);
    const line = `  ${this.label}  ${bar}  ${done}/${this.total}  ${gray(`${rate}/s`)}  ${suffix}`;
    if (this.isTty) {
      process.stdout.write(`\r\x1b[2K${line}`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  done(suffix = ''): void {
    this.tick(this.total, suffix);
    if (this.isTty) process.stdout.write('\n');
  }
}
