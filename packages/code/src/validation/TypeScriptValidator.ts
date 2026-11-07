/**
 * TypeScript Validator
 *
 * Runs TypeScript type checking and returns structured validation results.
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { ProcessSandbox } from '@batiste-aidk/core/sandbox';
import type { IValidator, ValidationResult, ValidationOptions } from './types.js';
import { logger } from '../utils/logger.js';

export class TypeScriptValidator implements IValidator {
  id = 'typescript';
  private log = logger.child('ts-validator');

  async validate(paths: string[], _options?: ValidationOptions): Promise<ValidationResult> {
    const startTime = performance.now();

    // Find the nearest tsconfig.json
    const tsconfigPath = await this.findTsConfig(paths[0] ?? process.cwd());
    if (!tsconfigPath) {
      return {
        passed: true,
        errors: [],
        warnings: [],
        durationMs: performance.now() - startTime,
      };
    }

    // Create a temp tsconfig that only checks the specified files
    const tempTsconfig = join(dirname(tsconfigPath), `.batiste-tscheck-${randomBytes(8).toString('hex')}.json`);
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf-8')) as {
      include?: string[];
      compilerOptions?: Record<string, unknown>;
    };
    tsconfig.include = paths;
    tsconfig.compilerOptions = {
      ...tsconfig.compilerOptions,
      noEmit: true,
    };

    // 'wx': falha se o nome ja existir (nao segue symlink plantado); 0o600: so o dono le.
    await writeFile(tempTsconfig, JSON.stringify(tsconfig, null, 2), { flag: 'wx', mode: 0o600 });

    const sandbox = new ProcessSandbox();
    await sandbox.initialize();

    try {
      const result = await sandbox.execute({
        command: 'npx',
        args: ['tsc', '--project', tempTsconfig, '--noEmit', '--pretty', 'false'],
        timeout: 60000,
        workingDir: dirname(tsconfigPath),
      });

      const durationMs = performance.now() - startTime;

      // Parse TypeScript error output
      const errors = this.parseTscOutput(result.stdout + result.stderr);

      return {
        passed: errors.length === 0,
        errors,
        warnings: [],
        durationMs,
      };
    } finally {
      await sandbox.destroy();
      try {
        await unlink(tempTsconfig);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private parseTscOutput(output: string): {
    file: string;
    line: number;
    column: number;
    message: string;
    rule: string;
    severity: 'error';
  }[] {
    const errors: {
      file: string;
      line: number;
      column: number;
      message: string;
      rule: string;
      severity: 'error';
    }[] = [];

    // Format: file(line,col): error TSxxxx: message
    const pattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(output)) !== null) {
      errors.push({
        file: match[1] ?? '',
        line: parseInt(match[2] ?? '0', 10),
        column: parseInt(match[3] ?? '0', 10),
        message: match[5] ?? '',
        rule: match[4] ?? '',
        severity: 'error',
      });
    }

    return errors;
  }

  private async findTsConfig(startPath: string): Promise<string | null> {
    let dir = dirname(startPath);
    const root = '/';

    while (dir !== root) {
      const candidate = join(dir, 'tsconfig.json');
      try {
        await readFile(candidate);
        return candidate;
      } catch {
        dir = dirname(dir);
      }
    }

    this.log.debug('No tsconfig.json found');
    return null;
  }
}
