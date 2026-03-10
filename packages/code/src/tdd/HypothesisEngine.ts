/**
 * Hypothesis Engine
 *
 * Implements the Red-Green-Refactor TDD cycle:
 * 1. RED: Write test, verify it fails
 * 2. GREEN: Write implementation, verify test passes
 * 3. REFACTOR: Run validation (ESLint, TypeScript)
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { ProcessSandbox } from '@batiste/core/sandbox';
import { Gatekeeper } from '../validation/Gatekeeper.js';
import type { Hypothesis, HypothesisResult, TDDOptions } from './types.js';
import { logger } from '../utils/logger.js';

export class HypothesisEngine {
  private log = logger.child('hypothesis-engine');

  createHypothesis(
    description: string,
    testCode: string,
    implementationCode: string,
    testFilePath: string,
    implementationFilePath: string
  ): Hypothesis {
    return {
      description,
      testCode,
      implementationCode,
      testFilePath,
      implementationFilePath,
    };
  }

  async runTDDCycle(
    hypothesis: Hypothesis,
    options: TDDOptions = {}
  ): Promise<HypothesisResult> {
    const { testTimeout = 30000, autoFix = false } = options;

    try {
      // Step 1: RED - Write test, verify it fails without implementation
      this.log.info('RED phase: Writing test...');
      await this.writeFile(hypothesis.testFilePath, hypothesis.testCode);

      const redResult = await this.runTests(hypothesis.testFilePath, testTimeout);

      if (redResult.exitCode === 0) {
        return {
          phase: 'red',
          passed: false,
          suggestions: [
            'Test passes without implementation - this means the test is not actually testing anything new.',
            'Consider making the test more specific or checking for the right behavior.',
          ],
          testResult: redResult,
        };
      }

      // Step 2: GREEN - Write implementation, verify test passes
      this.log.info('GREEN phase: Writing implementation...');
      await this.writeFile(hypothesis.implementationFilePath, hypothesis.implementationCode);

      const greenResult = await this.runTests(hypothesis.testFilePath, testTimeout);

      if (greenResult.exitCode !== 0) {
        return {
          phase: 'green',
          passed: false,
          suggestions: [
            'Test still fails after implementation.',
            'Check the test output for specific failures.',
            'The implementation may not satisfy the test expectations.',
          ],
          error: greenResult.stderr.slice(0, 500),
          testResult: greenResult,
        };
      }

      // Step 3: REFACTOR - Run validation
      this.log.info('REFACTOR phase: Validating code quality...');
      const gatekeeper = new Gatekeeper();
      const validation = await gatekeeper.preflightCheck(
        [hypothesis.testFilePath, hypothesis.implementationFilePath],
        { fix: autoFix }
      );

      if (!validation.passed) {
        const errorSummary = Array.from(validation.validatorResults.entries())
          .filter(([, r]) => !r.passed)
          .map(([id, r]) => `${id}: ${r.errors.length} errors`)
          .join(', ');

        return {
          phase: 'refactor',
          passed: false,
          suggestions: [
            `Code quality issues found: ${errorSummary}`,
            autoFix
              ? 'Auto-fix was attempted but some issues remain.'
              : 'Consider running with autoFix: true to fix automatically.',
          ],
          testResult: greenResult,
        };
      }

      // All phases passed
      return {
        phase: 'complete',
        passed: true,
        suggestions: [],
        testResult: greenResult,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        phase: 'error',
        passed: false,
        suggestions: [`Unexpected error during TDD cycle: ${message}`],
        error: message,
      };
    }
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }

  private async runTests(testFilePath: string, timeout: number) {
    const sandbox = new ProcessSandbox();
    await sandbox.initialize();

    try {
      return await sandbox.execute({
        command: 'npx',
        args: ['vitest', 'run', testFilePath, '--reporter=verbose'],
        timeout,
        workingDir: dirname(testFilePath),
      });
    } finally {
      await sandbox.destroy();
    }
  }
}
