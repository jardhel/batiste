/**
 * ESLint Validator
 *
 * Runs ESLint on files and returns structured validation results.
 */

import { ProcessSandbox } from '@batiste/core/sandbox';
import type { IValidator, ValidationResult, ValidationOptions } from './types.js';
import { logger } from '../utils/logger.js';

interface ESLintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
}

interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
}

export class ESLintValidator implements IValidator {
  id = 'eslint';
  private log = logger.child('eslint-validator');

  async validate(paths: string[], options?: ValidationOptions): Promise<ValidationResult> {
    const startTime = performance.now();
    const sandbox = new ProcessSandbox();
    await sandbox.initialize();

    try {
      const args = ['eslint', '--format', 'json'];
      if (options?.fix) {
        args.push('--fix');
      }
      args.push(...paths);

      const result = await sandbox.execute({
        command: 'npx',
        args,
        timeout: 60000,
      });

      const durationMs = performance.now() - startTime;

      // ESLint outputs JSON to stdout even on errors
      if (!result.stdout.trim()) {
        return {
          passed: true,
          errors: [],
          warnings: [],
          durationMs,
        };
      }

      try {
        const eslintResults = JSON.parse(result.stdout) as ESLintFileResult[];

        const errors = eslintResults.flatMap(file =>
          file.messages
            .filter(msg => msg.severity === 2)
            .map(msg => ({
              file: file.filePath,
              line: msg.line,
              column: msg.column,
              message: msg.message,
              rule: msg.ruleId ?? 'unknown',
              severity: 'error' as const,
            }))
        );

        const warnings = eslintResults.flatMap(file =>
          file.messages
            .filter(msg => msg.severity === 1)
            .map(msg => ({
              file: file.filePath,
              line: msg.line,
              column: msg.column,
              message: msg.message,
              rule: msg.ruleId ?? 'unknown',
            }))
        );

        return {
          passed: errors.length === 0,
          errors,
          warnings,
          durationMs,
        };
      } catch {
        this.log.warn('Failed to parse ESLint output');
        return {
          passed: result.exitCode === 0,
          errors: result.exitCode !== 0
            ? [{
                file: paths[0] ?? 'unknown',
                line: 0,
                column: 0,
                message: result.stderr || 'ESLint failed',
                rule: 'eslint-error',
                severity: 'error' as const,
              }]
            : [],
          warnings: [],
          durationMs,
        };
      }
    } finally {
      await sandbox.destroy();
    }
  }
}
