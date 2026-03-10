/**
 * Prompt Tools
 *
 * MCP tool definitions for dynamic prompt registration.
 * Agents use register_prompt / unregister_prompt to bring their own prompts.
 */

import type { ToolDefinition, PromptRegistry, PromptArgumentDefinition } from './types.js';

export const PROMPT_TOOLS: ToolDefinition[] = [
  {
    name: 'register_prompt',
    description: 'Register a prompt template. Use {{arg_name}} for placeholders.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique prompt name' },
        template: { type: 'string', description: 'Template with {{arg}} placeholders' },
        title: { type: 'string', description: 'Display title' },
        description: { type: 'string', description: 'Prompt description' },
        arguments: {
          type: 'array',
          description: 'Argument definitions',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              required: { type: 'boolean' },
            },
          },
        },
        role: { type: 'string', enum: ['user', 'assistant'], description: 'Message role (default: user)' },
      },
      required: ['name', 'template'],
    },
  },
  {
    name: 'unregister_prompt',
    description: 'Remove a previously registered prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Prompt name to remove' },
      },
      required: ['name'],
    },
  },
];

const PROMPT_TOOL_NAMES = new Set(PROMPT_TOOLS.map((t) => t.name));

export interface PromptToolResult {
  handled: boolean;
  result?: unknown;
}

export function handlePromptTool(
  registry: PromptRegistry,
  toolName: string,
  args: Record<string, unknown>,
  agentId: string,
): PromptToolResult {
  if (!PROMPT_TOOL_NAMES.has(toolName)) {
    return { handled: false };
  }

  if (toolName === 'register_prompt') {
    const name = args['name'] as string;
    const template = args['template'] as string;
    const title = args['title'] as string | undefined;
    const description = args['description'] as string | undefined;
    const argDefs = args['arguments'] as PromptArgumentDefinition[] | undefined;
    const role = (args['role'] as 'user' | 'assistant') ?? 'user';

    registry.register({
      definition: {
        name,
        title,
        description,
        arguments: argDefs,
      },
      registeredBy: agentId,
      registeredAt: new Date().toISOString(),
      resolve: async (resolveArgs) => ({
        description,
        messages: [
          {
            role,
            content: {
              type: 'text',
              text: substituteTemplate(template, resolveArgs),
            },
          },
        ],
      }),
    });

    return { handled: true, result: { registered: name } };
  }

  if (toolName === 'unregister_prompt') {
    const name = args['name'] as string;
    const removed = registry.unregister(name);
    return { handled: true, result: { unregistered: name, found: removed } };
  }

  return { handled: false };
}

function substituteTemplate(template: string, args: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => args[key] ?? `{{${key}}}`);
}
