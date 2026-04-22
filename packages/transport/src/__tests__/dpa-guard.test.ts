import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  decideOutbound,
  loadDpaProfile,
  type DpaProfile,
  type OutboundCall,
} from '../dpa-guard.js';

const noopRedact = (payload: string) => payload;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const nowFixed = () => '2026-04-22T12:00:00.000Z';
const ropaId = () => 'ropa-fixed';
const baseOptions = {
  redact: noopRedact,
  hash: sha256,
  ropaIdGenerator: ropaId,
  now: nowFixed,
  purpose: 'draft-contract-generation',
};

function profile(overrides: Partial<DpaProfile> = {}): DpaProfile {
  return loadDpaProfile({
    controller: 'Cachola Tech Holding B.V.',
    processor: 'Anthropic PBC',
    dpa_version: '2024-11-Anthropic',
    signed_on: '2026-04-22',
    allowed_regions: ['eu'],
    preferred_region: 'eu',
    sub_processors: [
      { name: 'AWS Frankfurt', region: 'eu', role: 'compute infrastructure' },
    ],
    retention_days: 30,
    ...overrides,
  });
}

function call(overrides: Partial<OutboundCall> = {}): OutboundCall {
  return {
    request_id: 'req-1',
    provider: 'anthropic',
    requested_region: 'eu',
    payload: 'draft a reset email for the counterparty',
    detected_categories: ['contact'],
    legal_basis: 'contract',
    data_subjects: ['counterparty-contact-person'],
    ...overrides,
  };
}

describe('decideOutbound (F6 DPA guard)', () => {
  it('allows an EU-bound call with a matching sub-processor and a lawful basis', () => {
    const d = decideOutbound(call(), profile(), baseOptions);
    expect(d.kind).toBe('allow');
    if (d.kind === 'allow') {
      expect(d.routedRegion).toBe('eu');
      expect(d.ropaEntry.controller).toBe('Cachola Tech Holding B.V.');
      expect(d.ropaEntry.payload_hash).toHaveLength(64);
    }
  });

  it('blocks a call whose region is not in allowed_regions', () => {
    const d = decideOutbound(
      call({ requested_region: 'us' }),
      profile({ allowed_regions: ['eu'] }),
      baseOptions,
    );
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.rule).toBe('residency');
  });

  it('blocks special-category data without an Art. 9 legal basis', () => {
    const d = decideOutbound(
      call({ detected_categories: ['contact', 'health'], legal_basis: 'contract' }),
      profile(),
      baseOptions,
    );
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.rule).toBe('special-categories');
  });

  it('allows special-category data when Art. 9 basis is declared and profile permits it', () => {
    const d = decideOutbound(
      call({ detected_categories: ['health'], legal_basis: 'art9-explicit-consent' }),
      profile({ special_categories_basis: 'art9-explicit-consent' }),
      baseOptions,
    );
    expect(d.kind).toBe('allow');
  });

  it('blocks when sub-processor allowlist has no entry for the requested region', () => {
    const d = decideOutbound(
      call({ requested_region: 'eu' }),
      profile({
        allowed_regions: ['eu', 'us'],
        sub_processors: [{ name: 'AWS Virginia', region: 'us', role: 'compute' }],
      }),
      baseOptions,
    );
    expect(d.kind).toBe('block');
    if (d.kind === 'block') expect(d.rule).toBe('sub-processor-allowlist');
  });

  it('emits a RoPA entry with stable shape', () => {
    const d = decideOutbound(call(), profile(), baseOptions);
    if (d.kind !== 'allow') throw new Error('expected allow');
    expect(d.ropaEntry).toMatchObject({
      id: 'ropa-fixed',
      controller: 'Cachola Tech Holding B.V.',
      processor: 'Anthropic PBC',
      purpose: 'draft-contract-generation',
      legal_basis: 'contract',
      data_categories: ['contact'],
      transfer_region: 'eu',
      retention_days: 30,
      timestamp: '2026-04-22T12:00:00.000Z',
    });
  });

  it('rejects malformed DPA profile at load time', () => {
    expect(() =>
      loadDpaProfile({
        controller: 'X',
        processor: 'Y',
        dpa_version: '',
        signed_on: '2026-04-22',
        allowed_regions: [],
        preferred_region: 'eu',
      }),
    ).toThrow();
  });
});
