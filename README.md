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
- `FAILED` and `ERROR` are exposed as separate summary counts.
- `SKIPPED` counts as skipped.
- No retry or flaky interpretation is inferred from status sequences.
- The current demo uses unique test names and does not simulate parameterized tests.

## Dashboard demos

The dashboard has one mixed demo report with unique test names and passed, failed, error, and skipped results. The dashboard loads it automatically and the `Load demo report` button reloads the same report.

The test suite includes a basic mock report and malformed-report coverage. Retry and parameterized scenarios are not simulated in the current dashboard.

## Persistence

The app uses PostgreSQL when `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or `POSTGRES_URL_NON_POOLING` is configured. On startup it creates the `afi_runs` and `afi_failure_groups` tables and reloads stored data. Without one of those variables, local development uses in-memory storage.

For Vercel, the Supabase integration can provide `POSTGRES_URL` and related variables automatically. After adding or changing the integration, redeploy. Do not commit the connection string to the repository.

## API

- `POST /api/test-runs/preview` - inspect a JUnit XML report without storing it.
- `POST /api/test-runs` - ingest a JUnit XML report.
- `GET /api/test-runs` - list ingested runs; supports `status` and `q` filters.
- `GET /api/health` - report storage mode and safe connection diagnostics.
- `GET /api/failure-groups` - list confirmed failure groups.
- `POST /api/demo/seed` - load the mixed demo report.

Authentication, deeper framework-specific adapters, normalized storage, and real Jira integration are future work.

