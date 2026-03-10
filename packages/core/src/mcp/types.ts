/**
 * MCP Server Types
 *
 * Shared types for building MCP tool servers.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolHandler {
  handleTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void>;
}

/**
 * Transport configuration for MCP servers.
 * - 'stdio': Standard input/output (default, backward compatible)
 * - 'gateway': StreamableHTTP over HTTPS
 */
export interface TransportConfig {
  mode: 'stdio' | 'gateway';
  /** Port for gateway mode (default: 3100) */
  port?: number;
  /** Host for gateway mode (default: '127.0.0.1') */
  host?: string;
  /** Enable stateful sessions with session ID generation (default: true for gateway) */
  stateful?: boolean;
}

export interface McpServerConfig {
  name: string;
  version: string;
  tools: ToolDefinition[];
  handler: ToolHandler;
  /** Transport config. Omit for stdio (backward compatible). */
  transport?: TransportConfig;
  /** Prompt registry for MCP prompts/list and prompts/get support. */
  promptRegistry?: PromptRegistry;
}

// --- Prompt Types ---

export interface PromptDefinition {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgumentDefinition[];
}

export interface PromptArgumentDefinition {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptMessageContent {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface PromptHandler {
  listPrompts(): Promise<PromptDefinition[]>;
  getPrompt(name: string, args: Record<string, string>): Promise<{
    description?: string;
    messages: PromptMessageContent[];
  }>;
}

/** Import type for PromptRegistry — concrete class is in prompt-registry.ts */
export interface PromptRegistry {
  register(prompt: RegisteredPrompt): void;
  unregister(name: string): boolean;
  list(): PromptDefinition[];
  get(name: string): RegisteredPrompt | undefined;
  onChange(listener: () => void): () => void;
}

export interface RegisteredPrompt {
  definition: PromptDefinition;
  registeredBy: string;
  registeredAt: string;
  resolve: (args: Record<string, string>) => Promise<{
    description?: string;
    messages: PromptMessageContent[];
  }>;
}
