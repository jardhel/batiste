/**
 * Validation Types
 *
 * Interfaces for code validation (ESLint, TypeScript, etc.)
 */

export interface ValidationError {
  file: string;
  line: number;
  column: number;
  message: string;
  rule: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  file: string;
  line: number;
  column: number;
  message: string;
  rule: string;
}

export interface ValidationResult {
  passed: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  durationMs: number;
}

export interface ValidationOptions {
  fix?: boolean;
  maxIssues?: number;
}

export interface IGatekeeper {
  preflightCheck(
    paths: string[],
    options?: ValidationOptions
  ): Promise<PreflightResult>;
}

export interface IGatekeeperRegistry {
  register(id: string, validator: IValidator): void;
  get(id: string): IValidator | undefined;
  getAll(): Map<string, IValidator>;
}

export interface IValidator {
  id: string;
  validate(paths: string[], options?: ValidationOptions): Promise<ValidationResult>;
}

export interface PreflightResult {
  passed: boolean;
  totalErrors: number;
  totalWarnings: number;
  durationMs: number;
  validatorResults: Map<string, ValidationResult>;
}
