/**
 * Sandbox Types
 *
 * Interfaces for isolated code execution environments.
 */

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  memoryUsage?: number;
}

export interface ExecutionOptions {
  command: string;
  args?: string[];
  workingDir?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxMemory?: number;
  networkEnabled?: boolean;
  mounts?: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
  stdin?: string;
}

export type SandboxStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface ISandbox {
  readonly id: string;
  readonly status: SandboxStatus;
  initialize(): Promise<void>;
  execute(options: ExecutionOptions): Promise<ExecutionResult>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export interface ISandboxFactory {
  create(options?: SandboxCreateOptions): Promise<ISandbox>;
  isAvailable(): Promise<boolean>;
}

export interface SandboxCreateOptions {
  image?: string;
  cpuLimit?: string;
  memoryLimit?: string;
}
