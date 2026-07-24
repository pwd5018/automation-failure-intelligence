export type ReportQualityStatus = "ACCEPTED" | "ACCEPTED_WITH_WARNINGS" | "QUARANTINED";
export type ReportQualityIssueSeverity = "WARNING" | "ERROR";
export type ReportQualityIssue = {
  code: string;
  severity: ReportQualityIssueSeverity;
  message: string;
};

export type ReportQuality = {
  status: ReportQualityStatus;
  issues: ReportQualityIssue[];
};

type QualityRecord = {
  identity: string;
  suite: string;
  testName: string;
};

type QualityMetadata = {
  tests?: string;
  failures?: string;
  errors?: string;
  skipped?: string;
};

type QualitySummary = {
  rawTestcaseRecords: number;
  failed: number;
  errors: number;
  skipped: number;
};

function declaredCount(name: keyof QualityMetadata, metadata: QualityMetadata): number | undefined {
  const value = metadata[name];
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function evaluateReportQuality(input: {
  rawRecords: QualityRecord[];
  reportMetadata: QualityMetadata;
  summary: QualitySummary;
}): ReportQuality {
  const issues: ReportQualityIssue[] = [];

  if (input.rawRecords.length === 0) {
    issues.push({
      code: "EMPTY_REPORT",
      severity: "ERROR",
      message: "No testcase records were found; the report is quarantined as UNKNOWN."
    });
  }

  const missingNames = input.rawRecords.filter(record => !record.testName.trim() || record.testName === "Unnamed test");
  if (missingNames.length > 0) {
    issues.push({
      code: "MISSING_TESTCASE_NAME",
      severity: "ERROR",
      message: `${missingNames.length} testcase record(s) have no trustworthy testcase name; the report is quarantined.`
    });
  }

  const identities = new Set<string>();
  const repeated = input.rawRecords.some(record => {
    if (identities.has(record.identity)) return true;
    identities.add(record.identity);
    return false;
  });
  if (repeated) {
    issues.push({
      code: "REPEATED_TEST_IDENTITY",
      severity: "WARNING",
      message: "Repeated test identities are preserved as separate reported results; no retry inference is applied."
    });
  }

  const declared = [
    ["tests", input.summary.rawTestcaseRecords],
    ["failures", input.summary.failed],
    ["errors", input.summary.errors],
    ["skipped", input.summary.skipped]
  ] as const;
  for (const [name, actual] of declared) {
    const expected = declaredCount(name, input.reportMetadata);
    if (expected !== undefined && expected !== actual) {
      issues.push({
        code: `DECLARED_${name.toUpperCase()}_MISMATCH`,
        severity: "WARNING",
        message: `Report declares ${expected} ${name} result(s), but ${actual} were parsed.`
      });
    }
  }

  const hasError = issues.some(issue => issue.severity === "ERROR");
  return {
    status: hasError ? "QUARANTINED" : issues.length ? "ACCEPTED_WITH_WARNINGS" : "ACCEPTED",
    issues
  };
}
