/**
 * AutoFixer - Multi-pass automatic code fixing
 *
 * Runs fix cycles until:
 * - Code is clean (no errors)
 * - No more fixes can be generated (convergence)
 * - Max iterations reached
 */

import { Gatekeeper } from '../validation/Gatekeeper.js';
import { DiffTracker, FileDiff } from './DiffTracker.js';
import { FixGenerator, FixSuggestion } from './FixGenerator.js';
import type { ValidationError } from '../validation/types.js';

export interface AutoFixOptions {
  maxIterations?: number;
  dryRun?: boolean;
  maxFixesPerIteration?: number;
  minConfidence?: 'high' | 'medium' | 'low';
}

export interface AutoFixResult {
  status: 'clean' | 'fixed' | 'partial' | 'no_fixes' | 'max_iterations';
  iterations: number;
  converged: boolean;
  dryRun: boolean;
  initialErrors: number;
  remainingErrors: number;
  totalFixesApplied: number;
  allFixes: FixSuggestion[];
  diffs: FileDiff[];
  diffSummary: string;
  iterationDetails: IterationDetail[];
}

interface IterationDetail {
  iteration: number;
  errorsFound: number;
  fixesGenerated: number;
  fixesApplied: number;
}

interface AutoFixerConfig {
  projectRoot: string;
}

export class AutoFixer {
  private _projectRoot: string;
  private gatekeeper: Gatekeeper;
  private generator: FixGenerator;

  constructor(config: AutoFixerConfig) {
    this._projectRoot = config.projectRoot;
    this.gatekeeper = new Gatekeeper();
    this.generator = new FixGenerator();
  }

  get projectRoot(): string {
    return this._projectRoot;
  }

  async fix(paths: string[], options: AutoFixOptions = {}): Promise<AutoFixResult> {
    const {
      maxIterations = 5,
      dryRun = false,
      maxFixesPerIteration = 20,
      minConfidence = 'high',
    } = options;

    const confidenceLevels = ['high', 'medium', 'low'];
    const minConfidenceIndex = confidenceLevels.indexOf(minConfidence);

    const allFixes: FixSuggestion[] = [];
    const iterationDetails: IterationDetail[] = [];
    let totalFixesApplied = 0;

    const tracker = new DiffTracker();
    await tracker.snapshot(paths);

    const initialValidation = await this.gatekeeper.preflightCheck(paths);
    const initialErrors = initialValidation.totalErrors;

    if (initialErrors === 0) {
      return {
        status: 'clean',
        iterations: 1,
        converged: true,
        dryRun,
        initialErrors: 0,
        remainingErrors: 0,
        totalFixesApplied: 0,
        allFixes: [],
        diffs: [],
        diffSummary: 'No changes needed',
        iterationDetails: [{ iteration: 1, errorsFound: 0, fixesGenerated: 0, fixesApplied: 0 }],
      };
    }

    let iteration = 0;
    let lastFixCount = -1;
    let converged = false;

    while (iteration < maxIterations) {
      iteration++;

      const validation = await this.gatekeeper.preflightCheck(paths);

      if (validation.totalErrors === 0) {
        converged = true;
        iterationDetails.push({
          iteration,
          errorsFound: 0,
          fixesGenerated: 0,
          fixesApplied: 0,
        });
        break;
      }

      const errors: ValidationError[] = [];
      for (const [, result] of validation.validatorResults) {
        errors.push(...result.errors);
      }

      const fixes = await this.generator.generateFixes(errors);

      const eligibleFixes = fixes.filter(fix => {
        const fixConfidenceIndex = confidenceLevels.indexOf(fix.confidence);
        return fixConfidenceIndex <= minConfidenceIndex;
      });

      if (eligibleFixes.length === 0 || eligibleFixes.length === lastFixCount) {
        converged = eligibleFixes.length === 0;
        iterationDetails.push({
          iteration,
          errorsFound: errors.length,
          fixesGenerated: fixes.length,
          fixesApplied: 0,
        });
        break;
      }

      lastFixCount = eligibleFixes.length;

      const fixesToApply = eligibleFixes.slice(0, maxFixesPerIteration);
      allFixes.push(...fixesToApply);

      let applied = 0;
      if (!dryRun) {
        const result = await this.generator.applyFixes(fixesToApply);
        applied = result.applied;
        totalFixesApplied += applied;
      }

      iterationDetails.push({
        iteration,
        errorsFound: errors.length,
        fixesGenerated: fixes.length,
        fixesApplied: applied,
      });

      if (!dryRun && applied === 0) {
        converged = true;
        break;
      }

      if (dryRun) break;
    }

    const finalValidation = await this.gatekeeper.preflightCheck(paths);
    const remainingErrors = finalValidation.totalErrors;

    const diffs = dryRun ? [] : await tracker.diff();
    const diffSummary = dryRun ? 'Dry run - no changes made' : tracker.getSummary(diffs);

    let status: AutoFixResult['status'];
    if (remainingErrors === 0) {
      status = 'clean';
    } else if (totalFixesApplied > 0 && remainingErrors < initialErrors) {
      status = 'fixed';
    } else if (totalFixesApplied > 0) {
      status = 'partial';
    } else if (iteration >= maxIterations) {
      status = 'max_iterations';
    } else {
      status = 'no_fixes';
    }

    return {
      status,
      iterations: iteration,
      converged,
      dryRun,
      initialErrors,
      remainingErrors,
      totalFixesApplied,
      allFixes,
      diffs,
      diffSummary,
      iterationDetails,
    };
  }
}
