import { describe, it, expect } from 'vitest';
import {
  green, red, yellow, cyan, bold, dim, gray,
  statusBadge, latencyBadge,
} from '../utils/output.js';

describe('output utilities', () => {
  describe('color helpers', () => {
    it('wraps string with ANSI green', () => {
      const result = green('hello');
      expect(result).toContain('hello');
      expect(result).toContain('\x1b[32m');
      expect(result).toContain('\x1b[0m');
    });

    it('wraps string with ANSI red', () => {
      const result = red('error');
      expect(result).toContain('error');
      expect(result).toContain('\x1b[31m');
    });

    it('wraps string with ANSI yellow', () => {
      expect(yellow('warn')).toContain('\x1b[33m');
    });

    it('wraps string with ANSI cyan', () => {
      expect(cyan('info')).toContain('\x1b[36m');
    });

    it('wraps string with bold', () => {
      expect(bold('title')).toContain('\x1b[1m');
    });

    it('wraps string with dim', () => {
      expect(dim('muted')).toContain('\x1b[2m');
    });

    it('wraps string with gray', () => {
      expect(gray('aside')).toContain('\x1b[90m');
    });
  });

  describe('statusBadge', () => {
    it('returns green for online', () => {
      expect(statusBadge('online')).toContain('\x1b[32m');
      expect(statusBadge('online')).toContain('online');
    });

    it('returns red for offline', () => {
      expect(statusBadge('offline')).toContain('\x1b[31m');
    });

    it('returns yellow for standby', () => {
      expect(statusBadge('standby')).toContain('\x1b[33m');
    });

    it('returns yellow for degraded', () => {
      expect(statusBadge('degraded')).toContain('\x1b[33m');
    });

    it('returns green for success', () => {
      expect(statusBadge('success')).toContain('\x1b[32m');
    });

    it('returns red for denied', () => {
      expect(statusBadge('denied')).toContain('\x1b[31m');
    });

    it('returns gray for unknown status', () => {
      expect(statusBadge('unknown')).toContain('\x1b[90m');
    });
  });

  describe('latencyBadge', () => {
    it('returns gray dash for null', () => {
      expect(latencyBadge(null)).toContain('—');
      expect(latencyBadge(null)).toContain('\x1b[90m');
    });

    it('returns gray dash for undefined', () => {
      expect(latencyBadge(undefined)).toContain('—');
    });

    it('returns green for <50ms', () => {
      expect(latencyBadge(20)).toContain('\x1b[32m');
      expect(latencyBadge(20)).toContain('ms');
    });

    it('returns yellow for 50–199ms', () => {
      expect(latencyBadge(100)).toContain('\x1b[33m');
    });

    it('returns red for >=200ms', () => {
      expect(latencyBadge(500)).toContain('\x1b[31m');
    });
  });
});
