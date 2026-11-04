import { describe, it, expect } from 'vitest';
import * as rls from '../index.js';
import type { AccessPolicy, Asset, Principal } from '../index.js';

const principal: Principal = { id: 'u1', roles: ['analyst'], groups: [] };
const asset: Asset = {
  uri: 'vault/05 Memory/nota.md',
  classification: 'INTERNAL',
  ownerId: 'u2',
};

// v0.1.0-alpha.1 is interfaces-only: evaluate/redact are declared stubs that
// throw NotImplementedError. These tests pin that surface so a change (real
// implementation or accidental removal) is a conscious, reviewed one.
describe('@batiste-aidk/rls public surface', () => {
  it('exports the documented runtime symbols', () => {
    expect(Object.keys(rls).sort()).toEqual(
      [
        'NotImplementedError',
        'REFERENCE_AGENCY_POLICY',
        'RLS_VERSION',
        'evaluate',
        'guardFor',
        'redact',
      ].sort(),
    );
    expect(rls.RLS_VERSION).toBe('0.1.0-alpha.1');
  });

  it('evaluate is a stub that fails loudly instead of returning a decision', () => {
    expect(() => rls.evaluate(principal, asset, 'read', rls.REFERENCE_AGENCY_POLICY)).toThrow(
      rls.NotImplementedError,
    );
  });

  it('redact is a stub that fails loudly instead of leaking content', () => {
    expect(() => rls.redact('segredo', { strategy: 'null' })).toThrow(/not yet implemented/);
  });

  it('NotImplementedError carries its name and the symbol', () => {
    const err = new rls.NotImplementedError('foo()');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotImplementedError');
    expect(err.message).toContain("'foo()'");
  });

  it('guardFor binds a principal and delegates to evaluate (fails closed while stubbed)', () => {
    const policy: AccessPolicy = { version: '0', defaultDecision: 'DENY', rules: [] };
    const guard = rls.guardFor(principal, policy);
    expect(typeof guard).toBe('function');
    expect(() => guard(asset, 'write')).toThrow(rls.NotImplementedError);
  });

  it('REFERENCE_AGENCY_POLICY is deny-by-default with unique rule ids', () => {
    const p = rls.REFERENCE_AGENCY_POLICY;
    expect(p.defaultDecision).toBe('DENY');
    const ids = p.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('external-no-access');
    const external = p.rules.find((r) => r.id === 'external-no-access');
    expect(external?.decision).toBe('DENY');
    for (const r of p.rules.filter((x) => x.decision === 'ALLOW_REDACTED')) {
      expect(r.redactSpec).toBeDefined();
    }
  });
});
