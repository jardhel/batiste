/**
 * File watcher with debouncing.
 *
 * Monitors a directory for file changes using Node.js fs.watch,
 * debounces rapid changes, and emits batched 'change' events
 * with an array of changed relative paths.
 */

import { watch, type FSWatcher } from 'fs';
import { join, relative } from 'path';
import { EventEmitter } from 'events';
import micromatch from 'micromatch';

export interface FileWatcherOptions {
  debounceMs?: number;
  ignorePatterns?: string[];
  recursive?: boolean;
}

export class FileWatcher extends EventEmitter {
  private rootDir: string;
  private options: Required<FileWatcherOptions>;
  private watcher: FSWatcher | null = null;
  private pendingChanges: Set<string> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;
  private watching = false;

  constructor(rootDir: string, options: FileWatcherOptions = {}) {
    super();
    this.rootDir = rootDir;
    this.options = {
      debounceMs: options.debounceMs ?? 500,
      ignorePatterns: options.ignorePatterns ?? [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
      ],
      recursive: options.recursive ?? true,
    };
  }

  async start(): Promise<void> {
    if (this.watching) return;

    this.watcher = watch(
      this.rootDir,
      { recursive: this.options.recursive },
      (_eventType, filename) => {
        if (filename) {
          this.handleChange(filename);
        }
      }
    );

    this.watcher.on('error', (error) => {
      this.emit('error', error);
    });

    this.watching = true;
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.pendingChanges.clear();
    this.watching = false;
  }

  isWatching(): boolean {
    return this.watching;
  }

  private handleChange(filename: string): void {
    const fullPath = join(this.rootDir, filename);
    const relativePath = relative(this.rootDir, fullPath);

    if (this.shouldIgnore(relativePath)) {
      return;
    }

    this.pendingChanges.add(relativePath);
    this.scheduleFlush();
  }

  private shouldIgnore(relativePath: string): boolean {
    return micromatch.isMatch(relativePath, this.options.ignorePatterns);
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.options.debounceMs);
  }

  private flush(): void {
    if (this.pendingChanges.size === 0) return;

    const changes = Array.from(this.pendingChanges);
    this.pendingChanges.clear();
    this.debounceTimer = null;

    this.emit('change', changes);
  }
}
