import { describe, expect, it } from 'vitest';
import { Plan } from '../plan.js';
import { CycleError } from '../types.js';

describe('Plan', () => {
  it('topologically sorts a diamond DAG (a -> b, a -> c, b -> d, c -> d)', () => {
    const plan = new Plan();
    const a = plan.add('a', async () => 'a');
    const b = plan.add('b', { deps: [a] }, async () => 'b');
    const c = plan.add('c', { deps: [a] }, async () => 'c');
    const d = plan.add('d', { deps: [b, c] }, async () => 'd');

    const order = plan.toposort();
    const pos = new Map(order.map((id, i) => [id, i]));
    expect(order).toHaveLength(4);
    expect(pos.get(a.id)!).toBeLessThan(pos.get(b.id)!);
    expect(pos.get(a.id)!).toBeLessThan(pos.get(c.id)!);
    expect(pos.get(b.id)!).toBeLessThan(pos.get(d.id)!);
    expect(pos.get(c.id)!).toBeLessThan(pos.get(d.id)!);
  });

  it('throws CycleError on a 2-node cycle', () => {
    // We cannot make a true a<->b cycle through `add()` because we'd need
    // b's handle before defining a. Build the cycle by tampering with an
    // op's deps in-place via a re-add that closes the loop.
    const plan = new Plan();
    const placeholder = plan.add('a-stub', async () => null);
    const b = plan.add('b', { deps: [placeholder] }, async () => 'b');
    // Hand-insert a synthetic cycle: replace 'a-stub' with one whose
    // deps point at b. Use the internal map exposed via operations().
    const ops = plan.operations() as Map<string, ReturnType<typeof plan.operations>['get'] extends (id: string) => infer R ? R : never>;
    const realA = {
      id: placeholder.id,
      name: 'a',
      deps: [b],
      fn: async () => 'a',
      weight: 1,
      tag: undefined,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ops as any).set(placeholder.id, realA);

    let err: unknown;
    try {
      plan.toposort();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CycleError);
    const ce = err as CycleError;
    expect([ce.edge.from, ce.edge.to]).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('passes upstream results into fn ctx.deps in declared order', async () => {
    const plan = new Plan();
    const x = plan.add('x', async () => 1);
    const y = plan.add('y', async () => 2);
    let captured: unknown[] = [];
    plan.add('z', { deps: [x, y] }, async ({ deps }) => {
      captured = deps;
      return null;
    });

    // Walk the DAG manually to exercise dep-passing without depending on
    // the executor for this unit test.
    const ops = plan.operations();
    const order = plan.toposort();
    const results = new Map<string, unknown>();
    for (const id of order) {
      const op = ops.get(id)!;
      const depResults = op.deps.map((d) => results.get(d.id));
      results.set(id, await op.fn({ deps: depResults }));
    }
    expect(captured).toEqual([1, 2]);
  });

  it('rejects deps that were not issued by this Plan', () => {
    const planA = new Plan();
    const orphan = planA.add('orphan', async () => null);
    const planB = new Plan();
    expect(() => planB.add('uses-orphan', { deps: [orphan] }, async () => null)).toThrow(
      /unknown dep/,
    );
  });
});
