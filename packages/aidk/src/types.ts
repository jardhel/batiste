import { z } from 'zod';

export const NodePresetSchema = z.enum(['local', 'network', 'enterprise']);
export type NodePreset = z.infer<typeof NodePresetSchema>;

export const NodeConfigSchema = z.object({
  preset: NodePresetSchema.default('local'),
  port: z.number().optional(),
  host: z.string().optional(),
  auth: z.object({
    secretKey: z.string(),
  }).optional(),
  scope: z.object({
    defaultPolicy: z.string().optional(),
  }).optional(),
  audit: z.object({
    dbPath: z.string().optional(),
    killSwitchEnabled: z.boolean().default(true),
  }).optional(),
  label: z.string().optional(),
});
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
