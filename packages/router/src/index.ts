/**
 * @batiste-aidk/router
 *
 * Local-first, audit-stamped model router. Declarative task→model policy that
 * chooses (but never executes) a model for an inference task; the host runs it
 * and the `@batiste-aidk/audit` middleware stamps the measured choice.
 *
 * SHIPPED: declarative policy + deterministic `route()` + manual override.
 * ROADMAP: local classifier, dpa-guard enforcement, per-op selection in
 * `@batiste-aidk/parallel`, tournament→learn. See README.md.
 */

export { BatisteRouter, type BatisteRouterOptions } from './router.js';
export { DEFAULT_POLICY } from './policy.js';
export {
  TaskSchema,
  MODALITY,
  WIDTH,
  PRIVACY,
  PLACEMENT,
  type Task,
  type TaskInput,
  type Modality,
  type Width,
  type Privacy,
  type Placement,
  type PolicyRule,
  type RouteDecision,
} from './types.js';
