import type { PolicyRule } from './types.js';

/**
 * The declarative routing policy — spec §2, "Tabela concreta", verbatim data
 * from the two feasibility tables. This is DATA, not logic: each entry says
 * "for this kind of task, prefer this model, here is the source". The router
 * (`router.ts`) walks it deterministically.
 *
 * Integrity line inherited from the feasibilities: parity holds only on a
 * NARROW task; the edge is local + private + cheap + auditable, never raw
 * force. NO token-economy number is a metric here.
 */
export const DEFAULT_POLICY: Record<string, PolicyRule> = {
  // Vision-read / OCR / doc → local VLM (DocVQA SOTA-open, data stays local).
  visionPrivateLocal: {
    id: 'vision-private-local',
    placement: 'local',
    modelId: 'qwen2.5-vl-7b',
    provider: 'local',
    reason:
      'local VLM is SOTA-open on DocVQA (95.7-96.4%), beats Gemini-1.5-Pro on OCRBench_v2; data never leaves the machine (MULTIMODAL_FEASIBILITY §1)',
    commercialSafe: true,
  },
  // Open / ambiguous spatial scene-reasoning → frontier.
  visionOpenFrontier: {
    id: 'vision-open-frontier',
    placement: 'frontier',
    modelId: 'frontier-vlm',
    provider: 'hosted',
    reason: 'open/ambiguous spatial scene-reasoning is where the hosted VLM wins (MULTIMODAL_FEASIBILITY §1)',
    commercialSafe: true,
  },
  // Image-gen preserving geometry → local diffusion (commercial-safe default).
  imageGenStagingLocal: {
    id: 'image-gen-staging-local',
    placement: 'local',
    modelId: 'sdxl-controlnet',
    provider: 'local',
    reason:
      'img2img denoise 0.3-0.5 + ControlNet locks structure; ~0 marginal cost, 100% private; SDXL+ControlNet / Flux schnell are Apache-2.0 commercial-safe (MULTIMODAL_FEASIBILITY §1-2)',
    commercialSafe: true,
  },
  // Open scene / magazine-cover generation → frontier.
  imageGenOpenFrontier: {
    id: 'image-gen-open-frontier',
    placement: 'frontier',
    modelId: 'flux-hosted',
    provider: 'hosted',
    reason: 'one-shot "looks expensive" finish on an open scene is where hosted brilha; honest hard line (MULTIMODAL_FEASIBILITY H1)',
    commercialSafe: true,
  },
  // Narrow text WITH a cheap oracle → local text + oracle-gated loop.
  textNarrowOracleLocal: {
    id: 'text-narrow-oracle-local',
    placement: 'local',
    modelId: 'qwen3-30b-a3b',
    provider: 'local',
    reason:
      'parity comes from the oracle-gated loop (runTDDCycle), not the weight; compiler/schema is the judge (FEASIBILITY §1-2, H2)',
    commercialSafe: true,
  },
  // Cheap narrow text, no oracle (label/rewrite/classify) → local text.
  textNarrowLocal: {
    id: 'text-narrow-local',
    placement: 'local',
    modelId: 'qwen3-30b-a3b',
    provider: 'local',
    reason: '"90% of local value lives in 20-35B" for narrow text (FEASIBILITY §2)',
    commercialSafe: true,
  },
  // Hard reasoning / multi-step / long context / long tail → frontier.
  reasoningHardFrontier: {
    id: 'reasoning-hard-frontier',
    placement: 'frontier',
    modelId: 'frontier-reasoning',
    provider: 'hosted',
    reason: 'the general gap on hard multi-step reasoning / long context is real and honest (FEASIBILITY §0)',
    commercialSafe: true,
  },
};
