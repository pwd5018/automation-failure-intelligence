# Automation Failure Intelligence

A small hosted sandbox for inspecting automated test results and grouping confirmed failures.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Run the regression suite with `npm test`.

For the contribution and deployment workflow, see [docs/GITHUB_WORKFLOW.md](docs/GITHUB_WORKFLOW.md).

## Current behavior

The current model is intentionally simple and truthful:

- Every raw testcase is one logical result by default.
- `PASSED` counts as passed.
- `FAILED` and `ERROR` count as failed.
- `FAILED` and `ERROR` are exposed as separate summary counts.
- `SKIPPED` counts as skipped.
- No retry or flaky interpretation is inferred from status sequences.
- The current demo uses unique test names and does not simulate parameterized tests.
- Failure groups appear in a selected run only when at least two failed/error tests share a signature.

## Dashboard demos

The dashboard loads four stable demo runs: a baseline mixed run, a clean pass, an expanded run with additional tests, and a shared-failure run that demonstrates grouping. The `Load demo runs` button loads or refreshes this pack without creating duplicate copies.

The test suite includes malformed, parameterized, nested, empty, large-report, and explicit framework-adapter fixtures. The dashboard reports source statuses directly and does not infer retries from status sequences.

## Persistence

The app uses PostgreSQL when `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or `POSTGRES_URL_NON_POOLING` is configured. On startup it creates the `afi_runs` and `afi_failure_groups` tables and reloads stored data. Without one of those variables, local development uses in-memory storage.

For Vercel, the Supabase integration can provide `POSTGRES_URL` and related variables automatically. After adding or changing the integration, redeploy. Do not commit the connection string to the repository.

## API

- `POST /api/test-runs/preview` - inspect a JUnit XML report without storing it.
- `POST /api/test-runs` - ingest a JUnit XML report.
- `GET /api/test-runs` - list ingested runs; supports `status` and `q` filters.
- `GET /api/health` - report storage mode and safe connection diagnostics.
- `GET /api/failure-groups` - list confirmed failure groups.
- `POST /api/demo/seed` - load the stable demo-run pack.

Authentication, deeper framework-specific result transformations, normalized storage, and real Jira integration are future work. Current framework adapters identify only explicitly declared report metadata; they do not infer framework behavior.
