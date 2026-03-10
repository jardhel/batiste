import { describe, it, expect, beforeEach } from 'vitest';
import { KillSwitch } from '../kill-switch.js';

describe('KillSwitch', () => {
  let ks: KillSwitch;

  beforeEach(() => {
    ks = new KillSwitch();
  });

  it('should allow sessions by default', () => {
    expect(ks.isAllowed('sess-1')).toBe(true);
    expect(ks.isPaused()).toBe(false);
  });

  it('should kill a specific session', () => {
    ks.execute({ action: 'kill_session', sessionId: 'sess-1', reason: 'test' });
    expect(ks.isKilled('sess-1')).toBe(true);
    expect(ks.isAllowed('sess-1')).toBe(false);
    expect(ks.isAllowed('sess-2')).toBe(true);
  });

  it('should pause all sessions', () => {
    ks.execute({ action: 'pause', reason: 'maintenance' });
    expect(ks.isPaused()).toBe(true);
    expect(ks.isAllowed('any-session')).toBe(false);
  });

  it('should resume after pause', () => {
    ks.execute({ action: 'pause', reason: 'test' });
    ks.execute({ action: 'resume', reason: 'done' });
    expect(ks.isPaused()).toBe(false);
    expect(ks.isAllowed('any-session')).toBe(true);
  });

  it('should kill all and pause', () => {
    ks.execute({ action: 'kill_all', reason: 'emergency' });
    expect(ks.isPaused()).toBe(true);
  });

  it('should notify listeners', () => {
    const commands: string[] = [];
    ks.onCommand((cmd) => commands.push(cmd.action));
    ks.execute({ action: 'pause', reason: 'test' });
    ks.execute({ action: 'resume', reason: 'test' });
    expect(commands).toEqual(['pause', 'resume']);
  });

  it('should track command history', () => {
    ks.execute({ action: 'pause', reason: 'r1' });
    ks.execute({ action: 'resume', reason: 'r2' });
    expect(ks.history()).toHaveLength(2);
    expect(ks.history()[0]!.reason).toBe('r1');
  });

  it('should reset all state', () => {
    ks.execute({ action: 'kill_session', sessionId: 's1', reason: 'test' });
    ks.execute({ action: 'pause', reason: 'test' });
    ks.reset();
    expect(ks.isKilled('s1')).toBe(false);
    expect(ks.isPaused()).toBe(false);
    expect(ks.history()).toHaveLength(0);
  });
});
