/**
 * Session Manager
 *
 * Tracks connected agent sessions with:
 * - Max concurrent session limits
 * - Idle timeout eviction
 * - Per-session request/byte tracking
 */

import { randomUUID } from 'node:crypto';
import type { SessionInfo } from './types.js';

export interface SessionManagerConfig {
  maxConcurrentSessions: number;
  sessionTimeoutMs: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly maxSessions: number;
  private readonly timeoutMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SessionManagerConfig) {
    this.maxSessions = config.maxConcurrentSessions;
    this.timeoutMs = config.sessionTimeoutMs;

    // Periodic cleanup of expired sessions
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
    // Unref so it doesn't keep the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Create a new session. Returns null if at capacity.
   */
  create(ip: string, agentId?: string): SessionInfo | null {
    this.evictExpired();

    if (this.sessions.size >= this.maxSessions) {
      return null;
    }

    const now = new Date().toISOString();
    const session: SessionInfo = {
      id: randomUUID(),
      agentId,
      connectedAt: now,
      lastActiveAt: now,
      ip,
      requestCount: 0,
      bytesTransferred: 0,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID. Returns null if not found or expired.
   */
  get(id: string): SessionInfo | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (this.isExpired(session)) {
      this.sessions.delete(id);
      return null;
    }

    return session;
  }

  /**
   * Record a request on a session.
   */
  touch(id: string, bytesTransferred?: number): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.lastActiveAt = new Date().toISOString();
    session.requestCount++;
    if (bytesTransferred) {
      session.bytesTransferred += bytesTransferred;
    }
  }

  /**
   * Remove a session.
   */
  remove(id: string): boolean {
    return this.sessions.delete(id);
  }

  /**
   * List all active sessions.
   */
  list(): SessionInfo[] {
    this.evictExpired();
    return Array.from(this.sessions.values());
  }

  /**
   * Get count of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session has expired.
   */
  private isExpired(session: SessionInfo): boolean {
    const lastActive = new Date(session.lastActiveAt).getTime();
    return Date.now() - lastActive > this.timeoutMs;
  }

  /**
   * Remove expired sessions.
   */
  private evictExpired(): void {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Shut down the session manager.
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}
