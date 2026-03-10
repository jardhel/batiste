/**
 * Scoped Handler
 *
 * Wraps a ToolHandler to enforce an access policy on every tool call.
 * Filters file arguments and results so agents never see out-of-scope data.
 */

import type { ToolHandler } from '@batiste/core/mcp';
import type { AccessPolicy } from './types.js';
import { FileMatcher } from './file-matcher.js';

export class ScopedHandler implements ToolHandler {
  private readonly inner: ToolHandler;
  private readonly matcher: FileMatcher;
  private readonly policy: AccessPolicy;

  constructor(handler: ToolHandler, policy: AccessPolicy) {
    this.inner = handler;
    this.policy = policy;
    this.matcher = new FileMatcher(policy);
  }

  async handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Filter file-like arguments
    const filteredArgs = this.filterArgs(args);

    // Delegate
    const result = await this.inner.handleTool(name, filteredArgs);

    // Filter results if they contain file paths
    return this.filterResult(result);
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }

  private filterArgs(args: Record<string, unknown>): Record<string, unknown> {
    const filtered = { ...args };

    for (const key of ['paths', 'entryPoints', 'files'] as const) {
      if (Array.isArray(filtered[key])) {
        filtered[key] = (filtered[key] as string[]).filter((p) => this.matcher.isAllowed(p));
      }
    }

    for (const key of ['path', 'filePath', 'testFilePath', 'implementationFilePath', 'workingDir'] as const) {
      if (typeof filtered[key] === 'string') {
        if (!this.matcher.isAllowed(filtered[key] as string)) {
          throw new ScopeError(`File '${filtered[key]}' is outside the access policy '${this.policy.name}'`);
        }
      }
    }

    // Limit depth for dependency analysis
    if (typeof filtered['maxDepth'] === 'number') {
      filtered['maxDepth'] = Math.min(filtered['maxDepth'] as number, this.policy.maxDepth);
    }

    return filtered;
  }

  private filterResult(result: unknown): unknown {
    // If result contains file paths in known structures, filter them
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj['files'])) {
        obj['files'] = (obj['files'] as string[]).filter((p) =>
          typeof p === 'string' ? this.matcher.isAllowed(p) : true,
        );
      }
      if (Array.isArray(obj['definitions'])) {
        obj['definitions'] = (obj['definitions'] as Array<Record<string, unknown>>).filter((d) =>
          typeof d['file'] === 'string' ? this.matcher.isAllowed(d['file']) : true,
        );
      }
      if (Array.isArray(obj['references'])) {
        obj['references'] = (obj['references'] as Array<Record<string, unknown>>).filter((r) =>
          typeof r['file'] === 'string' ? this.matcher.isAllowed(r['file']) : true,
        );
      }
    }
    return result;
  }
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}
