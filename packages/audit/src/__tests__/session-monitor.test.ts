import { describe, it, expect } from 'vitest';
import { SessionMonitor } from '../session-monitor.js';

describe('SessionMonitor', () => {
  it('should start and track a session', () => {
    const monitor = new SessionMonitor();
    monitor.start('sess-1', 'agent-1');
    expect(monitor.size).toBe(1);
    const s = monitor.get('sess-1');
    expect(s?.agentId).toBe('agent-1');
    expect(s?.toolCalls).toBe(0);
  });

  it('should record tool calls', () => {
    const monitor = new SessionMonitor();
    monitor.start('sess-1', 'agent-1');
    monitor.recordCall('sess-1', 50, false);
    monitor.recordCall('sess-1', 100, true);
    const s = monitor.get('sess-1')!;
    expect(s.toolCalls).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.totalDurationMs).toBe(150);
  });

  it('should stop and return session stats', () => {
    const monitor = new SessionMonitor();
    monitor.start('sess-1', 'agent-1');
    monitor.recordCall('sess-1', 50, false);
    const stopped = monitor.stop('sess-1');
    expect(stopped?.toolCalls).toBe(1);
    expect(monitor.size).toBe(0);
  });

  it('should list all sessions', () => {
    const monitor = new SessionMonitor();
    monitor.start('s1', 'a1');
    monitor.start('s2', 'a2');
    expect(monitor.list()).toHaveLength(2);
  });

  it('should ignore calls to unknown sessions', () => {
    const monitor = new SessionMonitor();
    // Should not throw
    monitor.recordCall('unknown', 10, false);
    expect(monitor.size).toBe(0);
  });
});
