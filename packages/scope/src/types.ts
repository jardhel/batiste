import { z } from 'zod';

export const AccessPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()).default([]),
  allowedSymbolTypes: z.array(z.enum([
    'function', 'class', 'interface', 'type', 'variable', 'import',
  ])).optional(),
  maxDepth: z.number().default(10),
  includeTests: z.boolean().default(false),
});
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;
