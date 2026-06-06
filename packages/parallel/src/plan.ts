/**
 * Plan — DAG construction + Kahn topological sort.
 *
 * A `Plan` is just a frozen-after-build description of operations. It does
 * not execute anything; the `Executor` consumes it. This separation keeps
 * the Plan trivially serializable in v1.4.1 when we ship work to
 * `worker_threads` (Plan describes the DAG; only `fn` itself is the part
 * that needs structured-cloning consideration).
 */

import { randomUUID } from 'node:crypto';
import {
  type AddOptions,
  type Operation,
  type OperationContext,
  type OperationHandle,
  CycleError,
} from './types.js';

export class Plan {
  private readonly ops = new Map<string, Operation>();
  /** Cache so `handleOf(id)` returns the SAME instance the caller got
   *  from `add()` — required for `Map<OperationHandle, …>` lookups. */
  private readonly handles = new Map<string, OperationHandle>();

  /** Two overloads: with-options and without. */
  add<T>(name: string, fn: (ctx: OperationContext) => Promise<T>): OperationHandle;
  add<T>(
    name: string,
    opts: AddOptions,
    fn: (ctx: OperationContext) => Promise<T>,
  ): OperationHandle;
  add<T>(
    name: string,
    optsOrFn: AddOptions | ((ctx: OperationContext) => Promise<T>),
    maybeFn?: (ctx: OperationContext) => Promise<T>,
  ): OperationHandle {
    const opts: AddOptions = typeof optsOrFn === 'function' ? {} : optsOrFn;
    const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
    if (!fn) throw new TypeError('Plan.add: fn is required');

    const id = randomUUID();
    const op: Operation<T> = {
      id,
      name,
      deps: opts.deps ?? [],
      fn,
      weight: opts.weight ?? 1,
      tag: opts.tag,
    };
    // Validate every declared dep is something we issued.
    for (const dep of op.deps) {
      if (!this.ops.has(dep.id)) {
        throw new Error(`Plan.add(${name}): unknown dep ${dep.name} (${dep.id})`);
      }
    }
    this.ops.set(id, op as Operation);

    const handle: OperationHandle = Object.freeze({
      __brand: 'OperationHandle' as const,
      id,
      name,
    });
    this.handles.set(id, handle);
    return handle;
  }

  /** Read-only snapshot for the executor. */
  operations(): ReadonlyMap<string, Operation> {
    return this.ops;
  }

  /**
   * Kahn's algorithm. Returns ids in a valid execution order
   * (every dep appears before the op that uses it).
   * Throws `CycleError` on cycles, naming the offending back-edge.
   */
  toposort(): string[] {
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // dep -> ops that depend on it

    for (const op of this.ops.values()) {
      indegree.set(op.id, op.deps.length);
      for (const dep of op.deps) {
        const list = dependents.get(dep.id) ?? [];
        list.push(op.id);
        dependents.set(dep.id, list);
      }
    }

    const ready: string[] = [];
    for (const [id, deg] of indegree) {
      if (deg === 0) ready.push(id);
    }

    const order: string[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      order.push(id);
      for (const child of dependents.get(id) ?? []) {
        const next = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, next);
        if (next === 0) ready.push(child);
      }
    }

    if (order.length !== this.ops.size) {
      // Find an op still with indegree > 0 and one of its incoming edges
      // for the error payload.
      let from = 'unknown';
      let to = 'unknown';
      for (const [id, deg] of indegree) {
        if (deg > 0) {
          const op = this.ops.get(id)!;
          to = op.name;
          // Pick a dep that itself never made it into `order` (i.e. is part
          // of the cycle); fall back to the first dep.
          const orderedSet = new Set(order);
          const cyclicDep = op.deps.find((d) => !orderedSet.has(d.id)) ?? op.deps[0];
          if (cyclicDep) from = cyclicDep.name;
          break;
        }
      }
      throw new CycleError(`cycle detected involving edge ${from} -> ${to}`, { from, to });
    }

    return order;
  }

  /** Convenience: ids -> handles for downstream consumers.
   *  Returns the SAME handle instance issued by `add()` so callers can
   *  use it as a Map key. */
  handleOf(id: string): OperationHandle | undefined {
    return this.handles.get(id);
  }
}
