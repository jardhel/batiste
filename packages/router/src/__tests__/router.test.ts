import { describe, it, expect } from 'vitest';
import { BatisteRouter } from '../router.js';
import { DEFAULT_POLICY } from '../policy.js';
import type { PolicyRule } from '../types.js';

const router = new BatisteRouter();

describe('BatisteRouter — declarative policy (spec §2 table)', () => {
  it('routes private vision / OCR / doc-read to the local VLM', () => {
    const d = router.route({ modality: 'vision-read', privacy: 'private' });
    expect(d.placement).toBe('local');
    expect(d.modelId).toBe('qwen2.5-vl-7b');
    expect(d.via).toBe('policy');
    expect(d.ruleId).toBe('vision-private-local');
  });

  it('routes public narrow vision to local (default-narrow), open public vision to frontier', () => {
    expect(router.route({ modality: 'vision-read', width: 'narrow' }).placement).toBe('local');
    const open = router.route({ modality: 'vision-read', width: 'open' });
    expect(open.placement).toBe('frontier');
    expect(open.ruleId).toBe('vision-open-frontier');
  });

  it('keeps private vision local even when the scene is open (honest capability trade)', () => {
    const d = router.route({ modality: 'vision-read', width: 'open', privacy: 'private' });
    expect(d.placement).toBe('local');
    expect(d.ruleId).toBe('vision-private-local');
  });

  it('routes geometry-preserving image staging to local diffusion', () => {
    const d = router.route({ modality: 'image-gen', width: 'narrow' });
    expect(d.placement).toBe('local');
    expect(d.ruleId).toBe('image-gen-staging-local');
    expect(d.commercialSafe).toBe(true); // SDXL+ControlNet / Flux schnell default
  });

  it('routes open-scene image generation to hosted', () => {
    const d = router.route({ modality: 'image-gen', width: 'open' });
    expect(d.placement).toBe('frontier');
    expect(d.ruleId).toBe('image-gen-open-frontier');
  });

  it('routes narrow text WITH an oracle to local + loop', () => {
    const d = router.route({ modality: 'text', width: 'narrow', hasOracle: true });
    expect(d.placement).toBe('local');
    expect(d.ruleId).toBe('text-narrow-oracle-local');
  });

  it('routes narrow text WITHOUT an oracle to local text', () => {
    const d = router.route({ modality: 'text', width: 'narrow', hasOracle: false });
    expect(d.placement).toBe('local');
    expect(d.ruleId).toBe('text-narrow-local');
  });

  it('routes hard/open reasoning to the frontier', () => {
    const d = router.route({ modality: 'text', width: 'open' });
    expect(d.placement).toBe('frontier');
    expect(d.ruleId).toBe('reasoning-hard-frontier');
  });

  it('routes long-context text to the frontier even when narrow', () => {
    const d = router.route({ modality: 'text', width: 'narrow', longContext: true });
    expect(d.placement).toBe('frontier');
    expect(d.ruleId).toBe('reasoning-hard-frontier');
  });

  it('keeps private text local even when hard/open (DPA-guard bias)', () => {
    const d = router.route({ modality: 'text', width: 'open', privacy: 'private', hasOracle: true });
    expect(d.placement).toBe('local');
    expect(d.ruleId).toBe('text-narrow-oracle-local');
  });
});

describe('BatisteRouter — defaults', () => {
  it('routes a bare text task (open by default) to the frontier', () => {
    const d = router.route({ modality: 'text' });
    expect(d.placement).toBe('frontier');
  });
});

describe('BatisteRouter — purity & determinism', () => {
  it('returns the same decision for the same task (deterministic)', () => {
    const task = { modality: 'text', width: 'narrow', hasOracle: true } as const;
    expect(router.route(task)).toEqual(router.route(task));
  });

  it('does not mutate the input task', () => {
    const task = { modality: 'text' as const };
    Object.freeze(task);
    expect(() => router.route(task)).not.toThrow();
  });

  it('returns plain data only (no model call / no side effects)', () => {
    const d = router.route({ modality: 'text', width: 'narrow', hasOracle: true });
    // Decision is serialisable plain data; the router never executes a model.
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(typeof d.modelId).toBe('string');
  });
});

describe('BatisteRouter — manual override (picker)', () => {
  it('honours an override verbatim and stamps via:override', () => {
    const d = router.route({
      modality: 'text',
      width: 'narrow',
      hasOracle: true,
      override: {
        placement: 'frontier',
        modelId: 'claude-opus-4-8',
        provider: 'anthropic',
        reason: 'human forced the frontier for this audit',
      },
    });
    expect(d.via).toBe('override');
    expect(d.placement).toBe('frontier');
    expect(d.modelId).toBe('claude-opus-4-8');
    expect(d.reason).toBe('human forced the frontier for this audit');
    expect(d.ruleId).toBeUndefined();
  });
});

describe('BatisteRouter — custom policy (whitelabel)', () => {
  it('uses a supplied policy table', () => {
    const custom: Record<string, PolicyRule> = {
      ...DEFAULT_POLICY,
      textNarrowLocal: {
        id: 'tenant-local',
        placement: 'local',
        modelId: 'tenant-tuned-7b',
        provider: 'local',
        reason: 'tenant-specific narrow model',
        commercialSafe: true,
      },
    };
    const r = new BatisteRouter({ policy: custom });
    const d = r.route({ modality: 'text', width: 'narrow' });
    expect(d.modelId).toBe('tenant-tuned-7b');
    expect(d.ruleId).toBe('tenant-local');
  });
});

describe('DEFAULT_POLICY — integrity', () => {
  it('carries no token-economy metric (no "saved"/"economia"/"%" claim)', () => {
    const blob = JSON.stringify(DEFAULT_POLICY).toLowerCase();
    expect(blob).not.toMatch(/token.{0,12}saved|saved.{0,12}token|economia|% saved|82\.9/);
  });

  it('marks every default model commercial-safe (no unlicensed FLUX dev/Kontext)', () => {
    for (const rule of Object.values(DEFAULT_POLICY)) {
      expect(rule.commercialSafe).toBe(true);
      expect(rule.modelId.toLowerCase()).not.toMatch(/flux.*dev|kontext/);
    }
  });
});
