# Automation Failure Intelligence

A small hosted sandbox for inspecting automated test results and grouping confirmed failures.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Run the regression suite with `npm test`.

## Current behavior

The current model is intentionally simple and truthful:

- Every raw testcase is one logical result by default.
- `PASSED` counts as passed.
- `FAILED` and `ERROR` count as failed.
- `SKIPPED` counts as skipped.
- Repeated names are shown as separate reported results.
- No retry or flaky interpretation is inferred from status sequences.
- Parameter/data-provider identifiers remain part of identity.

## Dashboard demos

The dashboard has one mixed demo report. It includes passed, failed, error, skipped, repeated-name, and parameterized testcase records. The dashboard loads it automatically and the `Load demo report` button reloads the same report.

The test suite also includes mock reports for basic outcomes, repeated identities, parameterized rows, and retry-looking sequences. These fixtures are intentionally interpreted as raw results without retry inference.

## Persistence

The app uses PostgreSQL when `DATABASE_URL` is configured. On startup it creates the `afi_runs` and `afi_failure_groups` tables and reloads stored data. Without `DATABASE_URL`, local development uses in-memory storage.

For Vercel, provision a PostgreSQL database through the project integrations, add its connection string as the `DATABASE_URL` environment variable for Preview and Production, then redeploy. Do not commit the connection string to the repository.

## API

- `POST /api/test-runs/preview` - inspect a JUnit XML report without storing it.
- `POST /api/test-runs` - ingest a JUnit XML report.
- `GET /api/test-runs` - list ingested runs.
- `GET /api/failure-groups` - list confirmed failure groups.
- `POST /api/demo/seed` - load the mixed demo report.

The prototype uses in-memory storage. Persistent storage, authentication, deeper framework-specific adapters, and real Jira integration are future work.

