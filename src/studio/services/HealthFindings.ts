export type HealthSeverity = "error" | "warning" | "info";

/** Plain report rows stay in the service. Only a bounded page enters Vue state. */
export interface HealthFinding {
  severity: HealthSeverity;
  message: string;
  summary: string;
  resourceId: string;
  resourceKind?: string;
  resourceName?: string;
}

export interface HealthFindingsQuery {
  search?: string;
  severity?: HealthSeverity | "all";
  code?: string;
  page?: number;
}

export interface HealthFindingsPage {
  groups: Array<{code: string; count: number; severity: HealthSeverity}>;
  total: number;
  page: number;
  pageSize: number;
  rows: HealthFinding[];
}

export interface HealthFindingsReader {
  queryFindings(query: HealthFindingsQuery): HealthFindingsPage;
}

interface FindingGroup {
  code: string;
  label: string;
  issues: HealthFinding[];
}

/** Search the complete report, not the samples retained for diagnostic summaries. */
export class HealthFindings {
  private _groups: FindingGroup[] = [];

  replace(groups: FindingGroup[]): void {
    this._groups = groups;
  }

  query(query: HealthFindingsQuery): HealthFindingsPage {
    const terms = (query.search || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const groups: HealthFindingsPage["groups"] = [];
    const matches: HealthFinding[] = [];
    for (const group of this._groups) {
      if (query.code && group.code !== query.code) continue;
      let count = 0;
      let severity: HealthSeverity = "info";
      for (const issue of group.issues) {
        if (query.severity && query.severity !== "all" && issue.severity !== query.severity) continue;
        if (terms.length) {
          const text = [group.code, group.label, issue.message, issue.summary, issue.resourceId,
            issue.resourceKind, issue.resourceName].join(" ").toLowerCase();
          if (!terms.every((term) => text.includes(term))) continue;
        }
        count++;
        if (issue.severity === "error" || (issue.severity === "warning" && severity === "info")) {
          severity = issue.severity;
        }
        // Summary queries return counts only; opening a category requests its rows.
        if (query.code) matches.push(issue);
      }
      if (count) groups.push({code: group.code, count, severity});
    }
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    const pageSize = 20;
    const requested = Number.isFinite(query.page) ? Math.floor(query.page!) : 1;
    const page = Math.max(1, Math.min(requested, Math.ceil(total / pageSize)));
    return {groups, total, page, pageSize,
      rows: matches.slice((page - 1) * pageSize, page * pageSize).map((issue) => ({...issue}))};
  }
}
