/** One deterministic, CPU-only schema validation finding. */
export interface RepresentationValidationIssue {

  /** Stable application-owned code suitable for tests and UI categorization. */
  code: string;

  /** Path relative to the definition, such as `parameters.radius` or `resources.density`. */
  path: string;

  /** Human-readable explanation. Consumers should use code, not parse this text. */
  message: string;
}
