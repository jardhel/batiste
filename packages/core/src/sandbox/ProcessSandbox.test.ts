import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessSandbox } from './ProcessSandbox.js';

describe('ProcessSandbox', () => {
  let sandbox: ProcessSandbox;

  beforeEach(async () => {
    sandbox = new ProcessSandbox();
    await sandbox.initialize();
  });

  afterEach(async () => {
    await sandbox.destroy();
  });

  it('should have a unique id', () => {
    expect(sandbox.id).toMatch(/^process-[a-f0-9]{8}$/);
  });

  it('should start in idle state', () => {
    expect(sandbox.status).toBe('idle');
  });

  it('should execute a simple command', async () => {
    const result = await sandbox.execute({
      command: 'echo',
      args: ['hello world'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('should capture stderr', async () => {
    const result = await sandbox.execute({
      command: 'sh',
      args: ['-c', 'echo error >&2'],
    });

    expect(result.stderr.trim()).toBe('error');
  });

  it('should handle command failure', async () => {
    const result = await sandbox.execute({
      command: 'sh',
      args: ['-c', 'exit 42'],
    });

    expect(result.exitCode).toBe(42);
  });

  it('should handle timeout', async () => {
    const result = await sandbox.execute({
      command: 'sleep',
      args: ['10'],
      timeout: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  it('should return to idle after execution', async () => {
    await sandbox.execute({
      command: 'echo',
      args: ['test'],
    });

    expect(sandbox.status).toBe('idle');
  });

  it('should throw when executing after destroy', async () => {
    await sandbox.destroy();

    await expect(
      sandbox.execute({ command: 'echo', args: ['test'] })
    ).rejects.toThrow('Sandbox has been destroyed');
  });

  it('should report as available', async () => {
    const available = await sandbox.isAvailable();
    expect(available).toBe(true);
  });

  it('should pass stdin to command', async () => {
    const result = await sandbox.execute({
      command: 'cat',
      stdin: 'hello from stdin',
    });

    expect(result.stdout.trim()).toBe('hello from stdin');
  });
});
