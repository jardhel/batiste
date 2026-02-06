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

export interface McpServerConfig {
  name: string;
  version: string;
  tools: ToolDefinition[];
  handler: ToolHandler;
}
