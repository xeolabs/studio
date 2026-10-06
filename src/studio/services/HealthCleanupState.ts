export interface HealthCleanupRun {
  timestamp: string;
  label: string;
  codes: string[];
  fixed: number;
  skipped: number;
  errors: number;
  errorMessage: string;
}

export interface HealthCleanupState {
  applying: boolean;
  fixableCodes: string[];
  fixableIssueCount: number;
  lastCleanupSummary: string;
  cleanupHistory: HealthCleanupRun[];
}
