/**
 * lineage.ts — record per-operation start/end events to an in-memory log
 * and (optionally) forward each event to a caller-supplied sink (e.g.
 * the audit ledger from `@batiste-aidk/audit`).
 *
 * Kept intentionally tiny: the executor owns lifecycle; this module
 * just normalises event shape so every consumer sees the same fields.
 */

import { randomUUID } from 'node:crypto';
import type { LineageEntry } from './types.js';

export class LineageRecorder {
  readonly entries: LineageEntry[] = [];

  constructor(private readonly sink?: (entry: LineageEntry) => void) {}

  /** Returns the per-op id so the matching `end()` call can reference it. */
  start(name: string, tag: string | undefined): { id: string; startedAt: string; t0: number } {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const entry: LineageEntry = { id, name, phase: 'start', startedAt, tag };
    this.entries.push(entry);
    this.emit(entry);
    return { id, startedAt, t0 };
  }

  end(args: {
    id: string;
    name: string;
    startedAt: string;
    t0: number;
    tag: string | undefined;
    result: 'success' | 'error';
    error?: { message: string };
  }): void {
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - args.t0;
    const entry: LineageEntry = {
      id: args.id,
      name: args.name,
      phase: 'end',
      startedAt: args.startedAt,
      endedAt,
      durationMs,
      result: args.result,
      tag: args.tag,
      ...(args.error ? { error: args.error } : {}),
    };
    this.entries.push(entry);
    this.emit(entry);
  }

  /** Synthetic skip: same shape as a normal end, but no `start` was emitted. */
  skip(name: string, tag: string | undefined, upstreamName: string): void {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entry: LineageEntry = {
      id,
      name,
      phase: 'end',
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      result: 'error',
      error: { message: `upstream failed: ${upstreamName}` },
      tag,
    };
    this.entries.push(entry);
    this.emit(entry);
  }

  private emit(entry: LineageEntry): void {
    if (!this.sink) return;
    try {
      this.sink(entry);
    } catch {
      // Sink failures must never break the executor — the lineage log
      // remains the source of truth and the caller can re-emit later.
    }
  }
}
