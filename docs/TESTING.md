# Testing and Deployment Verification

## Local verification

Run `npm test`. The suite builds TypeScript, starts the service, exercises the API, validates representative XML fixtures, and verifies malformed XML rejection.

Use [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md) to publish completed changes through the remote GitHub branch and Vercel workflow.

## Required coverage

- Passed, failed, error, and skipped records.
- Parameterized rows retain their parameters as part of result identity.
- Nested suites retain their suite path.
- Report attributes and properties are exposed as metadata.
- Valid empty reports return an explicit warning and an `UNKNOWN` result status.
- Explicit pytest and Maven Surefire metadata select adapter labels; unknown declarations remain generic with a warning.
- Larger reports retain complete record count and source order without retry inference.
- The dashboard displays adapter identity, report metadata, properties, and parser warnings.
- All registered adapters have explicit-metadata fixtures; root metadata precedence and unknown fallback are covered.
- The current demo uses unique test names and does not simulate parameterized rows.
- Run search and status filters.
- Storage health reporting.
- Duplicate ingestion behavior.
- Failure-group persistence behavior where a database is available.
- Single failed/error results do not appear as selected-run failure groups; shared signatures across multiple tests do.

## Vercel smoke test

1. Open `/api/health` and confirm `storage` is `postgres`.
2. Load the stable demo-run pack and inspect the clean, baseline, expanded, and shared-failure runs.
3. Confirm the run appears in history.
4. Refresh the dashboard.
5. Trigger a redeploy.
6. Confirm the run and failure groups remain available.

Never include database passwords or complete connection strings in bug reports.
