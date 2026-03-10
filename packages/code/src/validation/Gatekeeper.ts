/**
 * Gatekeeper
 *
 * Registry of validators and pre-flight check orchestrator.
 * Runs all registered validators and aggregates results.
 */

import type {
  IValidator,
  ValidationResult,
  ValidationOptions,
  PreflightResult,
} from './types.js';
import { ESLintValidator } from './ESLintValidator.js';
import { TypeScriptValidator } from './TypeScriptValidator.js';
import { logger } from '../utils/logger.js';

export class GatekeeperRegistry {
  private validators: Map<string, IValidator> = new Map();

  register(validator: IValidator): void {
    this.validators.set(validator.id, validator);
  }

  get(id: string): IValidator | undefined {
    return this.validators.get(id);
  }

  getAll(): Map<string, IValidator> {
    return this.validators;
  }
}

export class Gatekeeper {
  private registry: GatekeeperRegistry;
  private log = logger.child('gatekeeper');

  constructor() {
    this.registry = new GatekeeperRegistry();
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.registry.register(new ESLintValidator());
    this.registry.register(new TypeScriptValidator());
  }

  async preflightCheck(
    paths: string[],
    options?: ValidationOptions
  ): Promise<PreflightResult> {
    const startTime = performance.now();
    const validatorResults = new Map<string, ValidationResult>();
    let totalErrors = 0;
    let totalWarnings = 0;

    const validators = this.registry.getAll();

    // Run validators in parallel
    const entries = Array.from(validators.entries());
    const results = await Promise.allSettled(
      entries.map(async ([id, validator]) => {
        this.log.debug(`Running validator: ${id}`);
        const result = await validator.validate(paths, options);
        return { id, result };
      })
    );

    for (const settledResult of results) {
      if (settledResult.status === 'fulfilled') {
        const { id, result } = settledResult.value;
        validatorResults.set(id, result);
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
      } else {
        this.log.error('Validator failed:', settledResult.reason);
      }
    }

    const durationMs = performance.now() - startTime;

    return {
      passed: totalErrors === 0,
      totalErrors,
      totalWarnings,
      durationMs,
      validatorResults,
    };
  }
}
