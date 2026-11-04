/**
 * BatisteRouter — local-first, declarative model router.
 *
 * Generalises the shape of `@batiste-aidk/marketplace`'s `RoutingLayer.route()`
 * (candidate set → deterministic verdict) from compute nodes to inference
 * models. The router DOES NOT call a model: the runtime has no LLM client, by
 * design. It only *chooses* a model for a task and returns a {@link RouteDecision};
 * the HOST executes it and feeds the *measured* usage back through the audit
 * middleware's `resolveUsage` seam (see `@batiste-aidk/audit`), so every choice
 * is stamped model×task on the zero-trust ledger.
 *
 * `route()` is pure and deterministic: same task in → same decision out, no
 * I/O, no clock, no randomness. That is what makes the choice testable and the
 * stamp re-derivable.
 *
 * SHIPPED here: the declarative policy + deterministic selection + override.
 * NOT shipped (roadmap, see README): the small local classifier, dpa-guard
 * enforcement wiring, per-op selection inside parallel, and the tournament loop.
 */

import { DEFAULT_POLICY } from './policy.js';
import { TaskSchema, type PolicyRule, type RouteDecision, type Task, type TaskInput } from './types.js';

export interface BatisteRouterOptions {
  /** Override the policy table (whitelabel/tenant). Defaults to {@link DEFAULT_POLICY}. */
  policy?: Record<string, PolicyRule>;
}

export class BatisteRouter {
  private readonly policy: Record<string, PolicyRule>;

  constructor(options: BatisteRouterOptions = {}) {
    this.policy = options.policy ?? DEFAULT_POLICY;
  }

  /**
   * Decide which model runs a task. Pure & deterministic.
   *
   * A manual override short-circuits the heuristic and is itself recorded
   * (`via: 'override'`, `reason` carried verbatim) — no choice, automatic or
   * manual, escapes the stamp.
   */
  route(input: TaskInput): RouteDecision {
    const task = TaskSchema.parse(input);

    if (task.override) {
      return {
        placement: task.override.placement,
        modelId: task.override.modelId,
        provider: task.override.provider,
        reason: task.override.reason,
        commercialSafe: true,
        via: 'override',
      };
    }

    const rule = this.selectRule(task);
    return {
      placement: rule.placement,
      modelId: rule.modelId,
      provider: rule.provider,
      reason: rule.reason,
      commercialSafe: rule.commercialSafe,
      via: 'policy',
      ruleId: rule.id,
    };
  }

  /**
   * Walk the decision axes (spec §2) and pick the matching policy rule.
   * Local-first: try local, escalate to frontier only when the task demands it.
   * Private data biases toward local regardless of width (the DPA-guard angle;
   * full enforcement is roadmap).
   */
  private selectRule(task: Task): PolicyRule {
    switch (task.modality) {
      case 'vision-read': {
        // Private vision / OCR / doc-read stays local; open spatial scene
        // reasoning goes frontier — unless the data is private, in which case
        // we keep it local and accept the honest capability trade.
        if (task.width === 'open' && task.privacy === 'public') {
          return this.policy.visionOpenFrontier!;
        }
        return this.policy.visionPrivateLocal!;
      }

      case 'image-gen': {
        // Geometry-preserving staging → local diffusion; open-scene "looks
        // expensive" generation → hosted. Private forces local.
        if (task.width === 'open' && task.privacy === 'public') {
          return this.policy.imageGenOpenFrontier!;
        }
        return this.policy.imageGenStagingLocal!;
      }

      case 'text':
      default: {
        // Frontier owns hard/open reasoning and long context — but never when
        // the data is private (then local + honest capability trade).
        const needsFrontier = task.width === 'open' || task.longContext;
        if (needsFrontier && task.privacy === 'public') {
          return this.policy.reasoningHardFrontier!;
        }
        // Narrow text: oracle-gated loop closes the gap if an oracle exists.
        if (task.hasOracle) return this.policy.textNarrowOracleLocal!;
        return this.policy.textNarrowLocal!;
      }
    }
  }
}
