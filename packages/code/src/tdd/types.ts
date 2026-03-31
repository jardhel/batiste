/**
 * TDD (Test-Driven Development) Types
 *
 * Interfaces for the Hypothesis Engine that runs Red-Green-Refactor cycles.
 */

import type { ExecutionResult } from '@batiste-aidk/core/sandbox';
import type { ValidationResult } from '../validation/types.js';

export interface Hypothesis {
  description: string;
  testCode: string;
  implementationCode: string;
  testFilePath: string;
  implementationFilePath: string;
}

export interface HypothesisResult {
  phase: 'red' | 'green' | 'refactor' | 'complete' | 'error';
  passed: boolean;
  suggestions: string[];
  error?: string;
  testResult?: ExecutionResult;
  validationResult?: ValidationResult;
}

export interface TDDOptions {
  testTimeout?: number;
  autoFix?: boolean;
}

export interface IHypothesisEngine {
  createHypothesis(
    description: string,
    testCode: string,
    implementationCode: string,
    testFilePath: string,
    implementationFilePath: string
  ): Hypothesis;

  runTDDCycle(hypothesis: Hypothesis, options?: TDDOptions): Promise<HypothesisResult>;
}
