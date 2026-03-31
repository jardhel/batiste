/**
 * @batiste-aidk/aidk — The AI Development Kit
 *
 * One package that composes all Batiste building blocks:
 * - Transport (StreamableHTTP gateway)
 * - Auth (JWT tokens, scoped access)
 * - Scope (AST-level access control)
 * - Audit (logging, kill switch, compliance)
 *
 * Usage:
 *   import { createNode } from '@batiste-aidk/aidk';
 *   const node = await createNode({ config: { preset: 'network' }, tools, handler });
 */

export { createNode, type BatistNode, type CreateNodeOptions, type StaticPrompt } from './create-node.js';
export { resolvePreset, type ResolvedConfig } from './presets.js';
export { NodePresetSchema, NodeConfigSchema, type NodePreset, type NodeConfig } from './types.js';
