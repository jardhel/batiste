/**
 * Terminal output utilities
 *
 * ANSI formatting helpers for Batiste CLI output.
 * Zero external deps — inline escape codes only.
 */

const ESC = '\x1b[';

export const ansi = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  // Foreground
  green: `${ESC}32m`,
  red: `${ESC}31m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  white: `${ESC}97m`,
  gray: `${ESC}90m`,
  // Background
  bgBlack: `${ESC}40m`,
};

export function green(s: string): string {
  return `${ansi.green}${s}${ansi.reset}`;
}
export function red(s: string): string {
  return `${ansi.red}${s}${ansi.reset}`;
}
export function yellow(s: string): string {
  return `${ansi.yellow}${s}${ansi.reset}`;
}
export function cyan(s: string): string {
  return `${ansi.cyan}${s}${ansi.reset}`;
}
export function gray(s: string): string {
  return `${ansi.gray}${s}${ansi.reset}`;
}
export function bold(s: string): string {
  return `${ansi.bold}${s}${ansi.reset}`;
}
export function dim(s: string): string {
  return `${ansi.dim}${s}${ansi.reset}`;
}

// ─── Structured output ───────────────────────────────────────────────────────

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

export function section(title: string): void {
  process.stdout.write(`\n${bold(title)}\n${gray('─'.repeat(title.length))}\n`);
}

export function kv(key: string, value: string, pad = 20): void {
  process.stdout.write(`  ${gray(key.padEnd(pad))} ${value}\n`);
}

export function br(): void {
  process.stdout.write('\n');
}

/** Render a table from an array of rows (each row is an array of cell strings). */
export function table(headers: string[], rows: string[][]): void {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, i) =>
    Math.max(...allRows.map((r) => (r[i] ?? '').length)),
  );

  const line = (cells: string[], isHeader = false) => {
    const parts = cells.map((c, i) => {
      const padded = c.padEnd(widths[i] ?? 0);
      return isHeader ? bold(padded) : padded;
    });
    process.stdout.write(`  ${parts.join('  ')}\n`);
  };

  line(headers, true);
  process.stdout.write(`  ${gray(widths.map((w) => '─'.repeat(w)).join('  '))}\n`);
  rows.forEach((r) => line(r));
}

/** Colorise a status string for display. */
export function statusBadge(status: string): string {
  switch (status.toLowerCase()) {
    case 'online':   return green('● online');
    case 'standby':  return yellow('◑ standby');
    case 'offline':  return red('○ offline');
    case 'degraded': return yellow('◐ degraded');
    case 'success':  return green('✓ success');
    case 'denied':   return red('✗ denied');
    case 'error':    return red('✗ error');
    default:         return gray(status);
  }
}

/** Format a number as ms with colour. */
export function latencyBadge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return gray('—');
  if (ms < 50)  return green(`${ms.toFixed(0)}ms`);
  if (ms < 200) return yellow(`${ms.toFixed(0)}ms`);
  return red(`${ms.toFixed(0)}ms`);
}
