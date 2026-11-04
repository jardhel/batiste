import { z } from 'zod';

/**
 * @batiste-aidk/router — decision-axis types.
 *
 * These are the *features of the task* the router reads (spec §2). They are a
 * data-derived restatement of the two feasibility tables
 * (`tools/asymmetric-model/{FEASIBILITY,MULTIMODAL_FEASIBILITY}.md`), not
 * opinion. Nothing here calls a model; the router only *chooses* one and the
 * audit ledger *stamps* the choice. Execution is the host's job.
 */

/** Modality of the inference task. */
export const MODALITY = ['text', 'vision-read', 'image-gen'] as const;
export type Modality = (typeof MODALITY)[number];

/**
 * Task width. `narrow-with-oracle` means a cheap external judge exists
 * (compiler / schema / SHA / test) so a small local model reaches parity via
 * an oracle-gated loop, not via raw weight. `open` is long-tail / open-scene
 * where the frontier's general gap is real and honest.
 */
export const WIDTH = ['narrow-with-oracle', 'narrow', 'open'] as const;
export type Width = (typeof WIDTH)[number];

/**
 * Whether the task touches data that must not leave the machine. `private`
 * (health / biometric / whitelabel-client) is a *forcing* input toward a local
 * route — the DPA-guard angle of spec §3 seam 2. Enforcement wiring is roadmap;
 * here it only biases the declarative choice.
 */
export const PRIVACY = ['public', 'private'] as const;
export type Privacy = (typeof PRIVACY)[number];

/** Where the chosen model runs. */
export const PLACEMENT = ['local', 'frontier'] as const;
export type Placement = (typeof PLACEMENT)[number];

/**
 * A routed inference task. All fields except `modality` default conservatively
 * so a bare `{ modality: 'text' }` is routable.
 */
export const TaskSchema = z.object({
  modality: z.enum(MODALITY),
  width: z.enum(WIDTH).default('open'),
  privacy: z.enum(PRIVACY).default('public'),
  /** Does a cheap oracle (compiler/schema/SHA/test) gate this task? */
  hasOracle: z.boolean().default(false),
  /** Context does not fit a local model and only a frontier holds it. */
  longContext: z.boolean().default(false),
  /**
   * Manual override (picker, Copilot/Cursor/Claude-Code `/model` style). When
   * present the router returns it verbatim and records `via: 'override'`, so a
   * forced choice is as auditable as an automatic one (spec §2 override).
   */
  override: z
    .object({
      placement: z.enum(PLACEMENT),
      modelId: z.string().min(1),
      provider: z.string().min(1),
      reason: z.string().min(1),
    })
    .optional(),
});
/** Input accepted by `route()` — defaulted fields are optional for callers. */
export type TaskInput = z.input<typeof TaskSchema>;
/** Fully-resolved task after defaults are applied. */
export type Task = z.infer<typeof TaskSchema>;

/**
 * One row of the declarative routing policy (spec §2 table). `commercialSafe`
 * carries the licence flag — FLUX.1 dev / Kontext[dev] are non-commercial and
 * only enter a paid-licence whitelabel route; the default commercial path is
 * SDXL+ControlNet / Flux schnell (Apache-2.0).
 */
export interface PolicyRule {
  /** Human-readable id, used in the stamped `reason`. */
  id: string;
  /** Default placement this rule selects. */
  placement: Placement;
  /** Concrete model id (verifiable against the feasibility docs). */
  modelId: string;
  /** Provider tag — `local` or a hosted provider name. */
  provider: string;
  /** Why, sourced to a feasibility doc. Becomes the stamped reason. */
  reason: string;
  /** Whether the default model is commercial-safe without a paid licence. */
  commercialSafe: boolean;
}

/**
 * The router's verdict for one task. Pure data — `route()` returns this and
 * nothing else. The caller (host) executes the model and feeds the *measured*
 * usage back to the audit middleware (`resolveUsage`), closing the loop.
 */
export interface RouteDecision {
  placement: Placement;
  modelId: string;
  provider: string;
  reason: string;
  commercialSafe: boolean;
  /** How the decision was reached. */
  via: 'policy' | 'override';
  /** The policy rule id that matched (absent for overrides). */
  ruleId?: string;
}
