/**
 * Create Node
 *
 * Factory that creates a fully configured Batiste Node.
 * Composes transport, auth, scope, and audit building blocks
 * based on the preset and configuration.
 */

import { join } from 'node:path';
import type { ToolHandler, PromptDefinition, PromptMessageContent, ToolDefinition } from '@batiste/core/mcp';
import { createMcpServer, PromptRegistryImpl, PROMPT_TOOLS, handlePromptTool } from '@batiste/core/mcp';
import { startTransport, type TransportHandle } from '@batiste/transport';
import { TokenIssuer, TokenVerifier, createAuthMiddleware } from '@batiste/auth';
import { AccessPolicyEngine, ScopedHandler } from '@batiste/scope';
import { AuditLedger, KillSwitch, SessionMonitor, AuditedToolHandler } from '@batiste/audit';
import { NodeConfigSchema, type NodeConfig } from './types.js';
import { resolvePreset } from './presets.js';

export interface BatistNode {
  /** The transport handle (for stopping the server) */
  transport: TransportHandle;
  /** Token issuer (only for network/enterprise) */
  tokenIssuer?: TokenIssuer;
  /** Token verifier (only for network/enterprise) */
  tokenVerifier?: TokenVerifier;
  /** Kill switch (only for enterprise) */
  killSwitch?: KillSwitch;
  /** Audit ledger (only for network/enterprise with audit) */
  auditLedger?: AuditLedger;
  /** Session monitor */
  sessionMonitor?: SessionMonitor;
  /** Access policy engine (only for enterprise) */
  policyEngine?: AccessPolicyEngine;
  /** Prompt registry (when prompts are enabled) */
  promptRegistry?: PromptRegistryImpl;
  /** Stop the node and clean up resources */
  close(): Promise<void>;
}

export interface StaticPrompt {
  definition: PromptDefinition;
  resolve: (args: Record<string, string>) => Promise<{
    description?: string;
    messages: PromptMessageContent[];
  }>;
}

export interface CreateNodeOptions {
  config: NodeConfig;
  tools: Array<{ name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }>;
  handler: ToolHandler;
  /** Static prompts defined by the node owner */
  prompts?: StaticPrompt[];
  /** Enable dynamic prompt registration via register_prompt/unregister_prompt tools (default: true) */
  enableDynamicPrompts?: boolean;
}

export async function createNode(options: CreateNodeOptions): Promise<BatistNode> {
  const config = NodeConfigSchema.parse(options.config);
  const resolved = resolvePreset(config);

  let handler = options.handler;
  let tokenIssuer: TokenIssuer | undefined;
  let tokenVerifier: TokenVerifier | undefined;
  let killSwitch: KillSwitch | undefined;
  let auditLedger: AuditLedger | undefined;
  let sessionMonitor: SessionMonitor | undefined;
  let policyEngine: AccessPolicyEngine | undefined;
  let promptRegistry: PromptRegistryImpl | undefined;

  // Build tools list (may be extended with prompt tools)
  let tools: ToolDefinition[] = [...options.tools];

  // Prompt setup
  const hasPrompts = (options.prompts && options.prompts.length > 0) || options.enableDynamicPrompts !== false;
  if (hasPrompts) {
    promptRegistry = new PromptRegistryImpl();

    // Seed static prompts
    if (options.prompts) {
      for (const p of options.prompts) {
        promptRegistry.register({
          definition: p.definition,
          registeredBy: 'node-owner',
          registeredAt: new Date().toISOString(),
          resolve: p.resolve,
        });
      }
    }

    // Add dynamic prompt tools
    if (options.enableDynamicPrompts !== false) {
      tools = [...tools, ...PROMPT_TOOLS];

      // Wrap handler to intercept prompt tool calls
      const innerHandler = handler;
      const registry = promptRegistry;
      handler = {
        async handleTool(name: string, args: Record<string, unknown>) {
          const promptResult = handlePromptTool(registry, name, args, 'agent');
          if (promptResult.handled) return promptResult.result;
          return innerHandler.handleTool(name, args);
        },
        async close() {
          await innerHandler.close?.();
        },
      };
    }
  }

  // Layer 1: Scope (wraps handler)
  if (resolved.scopeEnabled && config.scope?.defaultPolicy) {
    policyEngine = new AccessPolicyEngine();
    policyEngine.register({
      name: config.scope.defaultPolicy,
      allowedPaths: ['src/**'],
      deniedPaths: ['**/*.env', '**/*.secret'],
      maxDepth: 10,
      includeTests: false,
    });
    // Default scope wraps the handler
    const policies = policyEngine.list();
    if (policies[0]) {
      handler = new ScopedHandler(handler, policies[0]);
    }
  }

  // Layer 2: Auth (wraps handler)
  if (resolved.authEnabled && config.auth) {
    tokenIssuer = new TokenIssuer({
      secretKey: config.auth.secretKey,
      defaultTtlMs: 3_600_000,
      projectId: config.label ?? 'batiste-node',
    });
    tokenVerifier = new TokenVerifier(config.auth.secretKey);

    handler = createAuthMiddleware(handler, {
      secretKey: config.auth.secretKey,
    });
  }

  // Layer 3: Audit (wraps handler)
  if (resolved.auditEnabled) {
    const dbPath = config.audit?.dbPath ?? join(process.cwd(), '.batiste', 'audit.db');
    auditLedger = new AuditLedger(dbPath);
    sessionMonitor = new SessionMonitor();

    if (resolved.killSwitchEnabled) {
      killSwitch = new KillSwitch();
    }

    handler = new AuditedToolHandler(handler, {
      ledger: auditLedger,
      killSwitch,
      monitor: sessionMonitor,
      sessionId: 'node-default',
      agentId: 'local',
    });
  }

  const finalHandler = handler;

  // Create MCP server factory (for gateway: one per session)
  const createServer = () => createMcpServer({
    name: config.label ?? '@batiste/aidk',
    version: '0.1.0',
    tools,
    handler: finalHandler,
    promptRegistry,
  });

  // Start transport
  const transport = await startTransport(
    resolved.mode === 'gateway' ? createServer : createServer(),
    resolved.mode === 'gateway'
      ? { mode: 'gateway', port: resolved.port, host: resolved.host, label: config.label }
      : { mode: 'stdio', label: config.label },
  );

  return {
    transport,
    tokenIssuer,
    tokenVerifier,
    killSwitch,
    auditLedger,
    sessionMonitor,
    policyEngine,
    promptRegistry,
    async close() {
      await transport.close();
      auditLedger?.close();
      sessionMonitor?.list().forEach((s) => sessionMonitor?.stop(s.id));
    },
  };
}
