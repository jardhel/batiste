/**
 * Access Policy Engine
 *
 * Evaluates access policies against tool calls.
 * Policies define which files, symbols, and depths are accessible.
 */

import { randomUUID } from 'node:crypto';
import { AccessPolicySchema, type AccessPolicy } from './types.js';
import { FileMatcher } from './file-matcher.js';

export class AccessPolicyEngine {
  private readonly policies = new Map<string, { policy: AccessPolicy; matcher: FileMatcher }>();

  /** Register a policy. Returns its ID. */
  register(input: Omit<AccessPolicy, 'id'> & { id?: string }): string {
    const policy = AccessPolicySchema.parse({ ...input, id: input.id ?? randomUUID() });
    this.policies.set(policy.id, { policy, matcher: new FileMatcher(policy) });
    return policy.id;
  }

  /** Get a policy by ID. */
  get(id: string): AccessPolicy | null {
    return this.policies.get(id)?.policy ?? null;
  }

  /** Check if a file is allowed under a policy. */
  isFileAllowed(policyId: string, filePath: string): boolean {
    const entry = this.policies.get(policyId);
    if (!entry) return false;
    return entry.matcher.isAllowed(filePath);
  }

  /** Filter file paths through a policy. */
  filterFiles(policyId: string, filePaths: string[]): string[] {
    const entry = this.policies.get(policyId);
    if (!entry) return [];
    return entry.matcher.filter(filePaths);
  }

  /** Check if a symbol type is allowed under a policy. */
  isSymbolTypeAllowed(policyId: string, symbolType: string): boolean {
    const entry = this.policies.get(policyId);
    if (!entry) return false;
    if (!entry.policy.allowedSymbolTypes) return true; // no restriction
    return entry.policy.allowedSymbolTypes.includes(symbolType as never);
  }

  /** Get the max traversal depth for a policy. */
  maxDepth(policyId: string): number {
    return this.policies.get(policyId)?.policy.maxDepth ?? 10;
  }

  /** Remove a policy. */
  remove(id: string): boolean {
    return this.policies.delete(id);
  }

  /** List all registered policies. */
  list(): AccessPolicy[] {
    return Array.from(this.policies.values()).map((e) => e.policy);
  }
}
