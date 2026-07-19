# Automation Failure Intelligence

A vertical-slice prototype for grouping noisy automated test failures into actionable Jira-ready failure groups.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Use **Load demo data** or upload a JUnit XML report.

Run the regression suite:

```bash
npm test
```

The fixture suite currently covers recovered retries, parameterized tests, duplicate uploads, and malformed XML. New customer-discovered report behavior should be added as a fixture and regression test before changing ingestion logic.

## Current slice

- JUnit XML upload
- Failure and error parsing
- Stable-ish normalization for URLs, timestamps, IDs, and line numbers
- Deterministic failure signatures
- Exact-signature grouping across runs
- Failure-group dashboard
- Human classification and investigation notes
- Jira issue-key linking boundary
- Raw testcase, test-definition, logical-invocation, and physical-attempt modeling
- Conservative unresolved-group handling for ambiguous duplicate identities
- Project-scoped skipped-then-terminal retry interpretation
- Recovered/flaky indicators with separate result and processing status
- Ingestion preview endpoint with warnings
- Duplicate report detection
- Raw report, raw status, semantic-role, profile, adapter, and resolution-audit retention

## Retry configuration

Retry interpretation is configured before ingestion at the project/source level. The default is conservative:

```text
retryAnalyzerEnabled: false
maxRetries: 0
skippedSequencePolicy: NORMAL_SKIPPED_SEMANTICS
ordinarySkippedPolicy: COUNT_AS_SKIPPED
ambiguousDuplicatePolicy: REQUIRE_REVIEW
```

Enable the known retry-analyzer behavior explicitly:

```text
retryAnalyzerEnabled: true
maxRetries: 1
skippedSequencePolicy: SKIPPED_THEN_TERMINAL_IS_RETRY
```

Save configuration with `PUT /api/retry-config` and provide the same `projectId` when previewing or ingesting a report. The run stores the configuration version, enabled state, retry budget, and skipped policy used for interpretation. A direct upload may also provide these fields for one-off preview/testing.

The dashboard includes selectable demo scenarios for `SKIPPED â†’ PASSED`, `SKIPPED â†’ FAILED`, the ambiguous `SKIPPED â†’ FAILED â†’ PASSED` sequence, and parameterized rows. Each scenario can be loaded using the current project configuration or a retry-disabled/retry-enabled preset. Previously loaded runs remain available in the run selector for comparison.

## Reporting model

Retries are represented as attempts inside one logical invocation. Duplicate records are not automatically paired when they could be retries or separate parameterized/data-provider invocations. Such records are retained in an unresolved group and excluded from resolved totals until explicitly classified.

The opt-in project profile `SKIPPED_THEN_TERMINAL_IS_RETRY` recognizes exactly two ordered records for the same invocation when the first is `SKIPPED` and the second is `PASSED` or `FAILED`. The skipped record retains `rawStatus: "SKIPPED"` and receives semantic role `RETRY_TRIGGERED_FAILURE`; it does not count as a skipped logical test. `NORMAL_SKIPPED_SEMANTICS` keeps ordinary skipped behavior and does not apply this retry interpretation. Empty `<skipped/>` elements are treated as skipped based on element presence, not text content.

Each run exposes `resultStatus` (`PASSED`, `FAILED`, `PARTIAL`, or `UNKNOWN`) separately from `processingStatus` (`COMPLETE` or `NEEDS_REVIEW`). A run with unresolved groups is never reported as fully passed. Unresolved records may contribute to raw physical-record counts, but never to resolved outcomes, failure groups, Jira recommendations, or defect alerts.

An unresolved group can be resolved for the current run through:

```text
POST /api/test-runs/:runId/unresolved-groups/:groupId/resolve
{"type":"TREAT_AS_RETRIES"}
```

Supported types are `TREAT_AS_RETRIES`, `TREAT_AS_SEPARATE_INVOCATIONS`, `TREAT_FIRST_RETRY_THEN_SEPARATE`, and `IGNORE_RECORDS`. The third option handles an ambiguous sequence such as `SKIPPED â†’ FAILED â†’ PASSED` as a failed retry pair followed by a separate passed invocation. Every resolution retains the raw records and adds a resolution-audit entry before recalculating totals. The current API supports `THIS_GROUP`; project-rule and run-wide resolution scopes remain future work.

Preview a report without changing dashboard data:

```bash
curl -F file=@report.xml -F build=build-123 -F environment=staging \
  http://localhost:3000/api/test-runs/preview
```

The preview reports physical attempts, estimated logical tests, possible retries, applied identity rules, and warnings.

The current prototype uses in-memory storage so the product workflow can be validated quickly. PostgreSQL persistence, authenticated project configuration management, and real Jira API linking remain production-foundation work. Framework-adapter expansion is intentionally out of scope for this slice.

