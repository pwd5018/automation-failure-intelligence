# Testing and Deployment Verification

## Local verification

Run `npm test`. The suite builds TypeScript, starts the service, exercises the API, validates representative XML fixtures, and verifies malformed XML rejection.

## Required coverage

- Passed, failed, error, and skipped records.
- Repeated names remain separate.
- Parameterized rows remain separate.
- Run search and status filters.
- Storage health reporting.
- Duplicate ingestion behavior.
- Failure-group persistence behavior where a database is available.

## Vercel smoke test

1. Open `/api/health` and confirm `storage` is `postgres`.
2. Load the mixed demo report.
3. Confirm the run appears in history.
4. Refresh the dashboard.
5. Trigger a redeploy.
6. Confirm the run and failure groups remain available.

Never include database passwords or complete connection strings in bug reports.

