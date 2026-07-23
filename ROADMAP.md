# Automation Failure Intelligence Roadmap

## Product direction

Automation Failure Intelligence is a private QA-triage workspace for understanding stored automated-test runs. The first release reports JUnit results exactly as received and keeps investigation evidence attached to the source run.

## Current status

- Truthful raw-result reporting is active.
- `PASSED`, `FAILED`, `ERROR`, and `SKIPPED` remain distinct source outcomes.
- The current demo uses unique test names and does not simulate parameterized tests.
- Retry and flaky inference are disabled.
- A stable demo-run pack and mock JUnit fixtures are available.
- Supabase/Postgres persistence is active in Vercel with an in-memory local fallback.
- Phase 3 real-world JUnit compatibility is implemented locally: nested suites, report metadata, empty reports, parameterized fixtures, large reports, and all registered explicit adapter labels are covered.
- Large-report coverage is active: upload size is explicit and repeated-identity detection is linear rather than quadratic.
- The dashboard now surfaces adapter identity, declared report metadata, properties, and parser warnings for each selected run.

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

### Phase 4 - Normalized database model

- Introduce indexed relational run and test-result records after the raw contract stabilizes.
- Retain the original XML/payload for provenance.
- Migrate without changing the API contract.

### Deferred collaboration work

- Authentication.
- Team/project isolation.
- Roles and audit history.
- CI/webhook ingestion.
- Automatic Jira integration.
- Retry and flaky inference without explicit framework metadata.

## Validation gate

Every phase must pass `npm test`, fixture validation, and a Vercel smoke test. The smoke test checks `/api/health`, loads the demo, refreshes, redeploys, and confirms stored runs remain available.
