import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session-manager.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      maxConcurrentSessions: 3,
      sessionTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    manager.close();
  });

  it('should create a session', () => {
    const session = manager.create('127.0.0.1');
    expect(session).not.toBeNull();
    expect(session!.ip).toBe('127.0.0.1');
    expect(session!.requestCount).toBe(0);
    expect(session!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should create session with agentId', () => {
    const session = manager.create('127.0.0.1', 'rust-refactorer');
    expect(session!.agentId).toBe('rust-refactorer');
  });

  it('should get a session by ID', () => {
    const session = manager.create('127.0.0.1')!;
    const retrieved = manager.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
  });

  it('should return null for unknown session ID', () => {
    expect(manager.get('nonexistent')).toBeNull();
  });

  it('should enforce max concurrent sessions', () => {
    manager.create('ip-1');
    manager.create('ip-2');
    manager.create('ip-3');
    expect(manager.create('ip-4')).toBeNull();
  });

  it('should allow creation after removing a session', () => {
    const s1 = manager.create('ip-1')!;
    manager.create('ip-2');
    manager.create('ip-3');
    expect(manager.create('ip-4')).toBeNull();

    manager.remove(s1.id);
    const s4 = manager.create('ip-4');
    expect(s4).not.toBeNull();
  });

  it('should touch a session and increment request count', () => {
    const session = manager.create('127.0.0.1')!;
    expect(session.requestCount).toBe(0);

    manager.touch(session.id, 1024);
    const updated = manager.get(session.id)!;
    expect(updated.requestCount).toBe(1);
    expect(updated.bytesTransferred).toBe(1024);
  });

  it('should list all active sessions', () => {
    manager.create('ip-1');
    manager.create('ip-2');
    expect(manager.list()).toHaveLength(2);
  });

  it('should report size correctly', () => {
    expect(manager.size).toBe(0);
    manager.create('ip-1');
    expect(manager.size).toBe(1);
  });

  it('should evict expired sessions', async () => {
    const shortManager = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTimeoutMs: 50,
    });

    shortManager.create('ip-1');
    expect(shortManager.size).toBe(1);

    await new Promise((r) => setTimeout(r, 100));

    // Eviction happens on list/create/get
    expect(shortManager.list()).toHaveLength(0);
    shortManager.close();
  });

  it('should return null for expired session on get', async () => {
    const shortManager = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTimeoutMs: 50,
    });

    const session = shortManager.create('ip-1')!;
    await new Promise((r) => setTimeout(r, 100));

    expect(shortManager.get(session.id)).toBeNull();
    shortManager.close();
  });

  it('should close and clear all sessions', () => {
    manager.create('ip-1');
    manager.create('ip-2');
    manager.close();
    expect(manager.size).toBe(0);
  });
});
