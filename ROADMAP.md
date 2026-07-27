# Automation Failure Intelligence Roadmap

## Product direction

Automation Failure Intelligence is a private QA-triage workspace for understanding stored automated-test runs. The first release reports JUnit results exactly as received and keeps investigation evidence attached to the source run.

## Current status

- Truthful raw-result reporting is active.
- `PASSED`, `FAILED`, `ERROR`, and `SKIPPED` remain distinct source outcomes.
- The demo pack now includes a TestNG data-provider run that can be collapsed with explicit retry metadata and a metadata-poor run that is surfaced for review.
- Retry and flaky inference are disabled.
- A stable one-run TestNG-style JUnit demo pack and mock JUnit fixtures are available.
- Supabase/Postgres persistence is active in Vercel with an in-memory local fallback.
- Phase 3 real-world JUnit compatibility is implemented locally: nested suites, report metadata, empty reports, parameterized fixtures, large reports, and all registered explicit adapter labels are covered.
- Large-report coverage is active: upload size is explicit and repeated-identity detection is linear rather than quadratic.
- The dashboard now surfaces adapter identity, declared report metadata, properties, and parser warnings for each selected run.
- Phase 4 normalized persistence and read reconstruction are implemented and validated on the remote `main` branch.
- Phase 5 Slice 1 is implemented on the report-quality branch: shared quality classification, declared-count warnings, repeated-identity warnings, and pre-ingestion quarantine for missing testcase names.
- Phase 5 Slice 2 adds explicit source provenance to run responses and normalized Postgres metadata: source type/name, external run ID, project/build/environment, ingestion timestamp, and content hash.
- Phase 6 Slice 1 adds a focused read-only testcase-detail endpoint that returns one source result with run provenance while excluding the raw XML payload.
- TestNG retry/skip slice adds explicit TestNG identity aggregation, true-skip classification, ordered attempt history, logical totals, flaky recovery, and retry counts.
- Phase 6 data-provider slice adds explicit metadata collapse, an ambiguity-safe needs-review fallback, observed pass/fail/error/skip counts for review groups, and demo fixtures for both routes.
- Persistence hardening now serializes persistent state refreshes and writes, propagates database failures, bulk-writes normalized rows, stores failure-group occurrences separately from group JSONB payloads, and persists validated project retry policies.

## Phases

### Phase 1 - Stored run workspace (implemented)

Current implementation slice:

- Separate failed and error counts.
- Search and status filters for stored runs.
- Test-level search and status filters.
- Visible storage connection state.
- Clear run metadata and mobile-friendly result rows.

### Phase 2 - Failure triage workspace (implemented)

- Preserve exact normalized failure signatures.
- Link groups to exact runs and test results.
- Preserve failed versus error outcomes in group evidence.
- Filter groups by outcome and search term.
- Navigate from a failure group to the exact stored run and test result.
- Show first/last occurrence timestamps and exact reported evidence.
- Validate and persist classification, notes, and manually entered Jira links.
- Show a failure group only when multiple failed/error tests in the selected run share its signature.
- Keep Jira integration manual for now.

### Phase 3 - Real-world JUnit compatibility (implemented locally)

- First slice implemented: the generic parser now preserves testcase names exactly, walks nested suites, exposes basic report metadata/properties, and warns on valid empty reports.
- Regression coverage now includes parameterized rows and nested metadata reports.
- Explicit framework detection now selects adapters only from declared framework metadata; unknown declarations remain generic with a warning.
- Large-report regression coverage verifies complete record count, order, source statuses, and no retry inference.
- Dashboard regression coverage verifies the compatibility metadata fields remain present in the served UI source.
- Framework-shaped fixtures cover pytest, Maven Surefire, NUnit, xUnit, Jest, Playwright, and Cypress declarations.
- Adapter precedence and unknown-framework fallback are regression-tested.
- Remaining deployment gate: Vercel `/api/health` and persistence smoke test.
- Do not infer retries from status sequences.

### Phase 4 - Normalized database model (implemented)

- Add normalized run columns and indexed `afi_test_results` rows beside the existing JSONB payload.
- Retain the original payload and XML provenance during the transition.
- Dual-write normalized run/test-result records transactionally with run-scoped testcase IDs.
- Reconstruct persisted run reads from normalized rows while retaining JSONB fallback for legacy runs.
- Validate restart, multi-instance reads, and API-contract parity. (Completed.)
- Do not change parser semantics, result identity, or retry/flaky behavior.

### Phase 5 - Report quality and ingestion readiness (planned)

Before accepting externally ingested reports, establish a clean and trustworthy report boundary:

- Define report-quality checks for malformed, empty, incomplete, duplicate, and structurally ambiguous reports. (Slice 1 adds shared quality statuses/issues and initial empty, missing-name, repeated-identity, and declared-count checks.)
- Preserve source provenance and identify the external source, project, build, environment, and ingestion timestamp. (Slice 2 adds explicit provenance fields and normalized storage columns.)
- Surface actionable validation warnings without changing source XML semantics.
- Quarantine or reject reports that cannot meet the stored-result contract.
- Verify normalized JSONB/read parity across baseline, large, nested, parameterized, and explicit-adapter fixtures.
- Add regression coverage for repeated uploads, concurrent ingestion, large reports, and persistence failures.
- Keep manual upload as the controlled ingestion path until this phase closes.

External CI/webhook ingestion remains a later phase and begins only after the Phase 5 quality gate and Phase 6 investigation-workspace gate pass.

### Phase 6 - Test detail investigation workspace (in progress)

Add a focused result-detail surface for investigating one reported testcase at a time:

- Slice 1 (implemented): `GET /api/test-runs/:runId/results/:testId` returns source name, suite, class, parameters, source order, status, duration, failure/error evidence, provenance, and explicit attempt data without returning raw XML.
- Data-provider slice (implemented): metadata-rich repeated identities collapse into iterations/attempts; metadata-poor or ambiguous repeated identities remain grouped as `NEEDS REVIEW` with raw records and observed counts.
- Result-detail slice (implemented): result rows and failure evidence open a focused detail workspace with iteration totals, outcome counts, and per-attempt evidence.
- Result-classification slice (implemented): individual failed/review results accept persisted dispositions, Jira references, and notes; matching prior decisions are offered as confirmation suggestions on later runs.
- Phase 7 is now reserved for user-resolved ambiguity overlays; external ingestion and collaboration move to Phase 8.
- Remaining gate: complete mobile/Vercel validation for the detail workspace.
- Mobile-friendly navigation from the run workspace and failure evidence.
- Preserve the exact source contract and keep the main dashboard lightweight.

### Phase 7 - Manual ambiguity resolution (next)

Give users an explicit, run-scoped way to resolve metadata-poor TestNG groups without changing the source XML or global parser rules:

- Select raw records within a `NEEDS REVIEW` group and split them into separate logical tests/iterations.
- Combine selected records into one logical test with ordered attempts.
- Name or identify the resulting logical test and choose its terminal outcome.
- Preview the resulting totals before saving.
- Persist the resolution for that specific run and allow it to be reopened, edited, or reset.
- Keep unresolved records visible as `NEEDS REVIEW` and retain every raw record for auditability.

### Phase 8 - External ingestion and collaboration (future)

- CI/webhook ingestion.
- Authentication.
- Team/project isolation.
- Roles and audit history.
- Automatic Jira integration.

### Deferred behavior work

- Retry and flaky inference without explicit framework metadata.

## Validation gate

Every phase must pass `npm test`, fixture validation, and a Vercel smoke test. The smoke test checks `/api/health`, loads the demo, refreshes, redeploys, and confirms stored runs remain available.

The remote-first publishing procedure is documented in [docs/GITHUB_WORKFLOW.md](docs/GITHUB_WORKFLOW.md). Phase work should be transferred to GitHub and merged into `main` through a focused pull request before the phase is considered delivered.
