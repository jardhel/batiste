/**
 * Kill Switch
 *
 * In-process kill switch for terminating agent sessions.
 * Tracks paused/killed state per session and globally.
 * (WebSocket upgrade is optional — this works standalone.)
 */

import { randomUUID } from 'node:crypto';
import type { KillCommand } from './types.js';

export type KillSwitchListener = (command: KillCommand) => void;

export class KillSwitch {
  private readonly killedSessions = new Set<string>();
  private paused = false;
  private readonly listeners: KillSwitchListener[] = [];
  private readonly commandLog: Array<KillCommand & { id: string; timestamp: string }> = [];

  /** Execute a kill command. */
  execute(command: KillCommand): void {
    const entry = { ...command, id: randomUUID(), timestamp: new Date().toISOString() };
    this.commandLog.push(entry);

    switch (command.action) {
      case 'kill_session':
        if (command.sessionId) this.killedSessions.add(command.sessionId);
        break;
      case 'kill_all':
        this.paused = true; // kill_all also pauses new connections
        break;
      case 'pause':
        this.paused = true;
        break;
      case 'resume':
        this.paused = false;
        break;
    }

    for (const listener of this.listeners) {
      listener(command);
    }
  }

  /** Check if a session has been killed. */
  isKilled(sessionId: string): boolean {
    return this.killedSessions.has(sessionId);
  }

  /** Check if the system is paused. */
  isPaused(): boolean {
    return this.paused;
  }

  /** Check if a session is allowed to proceed. */
  isAllowed(sessionId: string): boolean {
    return !this.paused && !this.killedSessions.has(sessionId);
  }

  /** Register a listener for kill commands. */
  onCommand(listener: KillSwitchListener): void {
    this.listeners.push(listener);
  }

  /** Get command history. */
  history(): Array<KillCommand & { id: string; timestamp: string }> {
    return [...this.commandLog];
  }

  /** Clear all kill states (for testing). */
  reset(): void {
    this.killedSessions.clear();
    this.paused = false;
    this.commandLog.length = 0;
  }
}
