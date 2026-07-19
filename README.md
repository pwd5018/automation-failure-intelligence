# Automation Failure Intelligence

A small hosted sandbox for inspecting automated test results and grouping confirmed failures.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Run the regression suite with `npm test`.

## Current behavior

The current model is intentionally simple and predictable:

- Every raw testcase is one logical result by default.
- `PASSED` counts as passed.
- `FAILED` and `ERROR` count as failed.
- `SKIPPED` counts as skipped.
- Repeated names are not merged automatically.
- When retry analyzer behavior is enabled, only an exact ordered `SKIPPED -> PASSED` or `SKIPPED -> FAILED` pair is collapsed into one retry result.
- `SKIPPED -> FAILED -> PASSED` becomes a failed retry result followed by a separate passed result.
- Parameter/data-provider identifiers remain part of identity.

When retry behavior is disabled, skipped records are never treated as failed or retried.

## Configuration

Retry behavior can be saved per project through `PUT /api/retry-config`:

```json
{
  "projectId": "checkout",
  "retryAnalyzerEnabled": true,
  "ordinarySkippedPolicy": "COUNT_AS_SKIPPED"
}
```

The configuration is currently in memory and is applied to later uploads using the same `projectId`.

## Dashboard demos

The dashboard includes scenarios for:

- `SKIPPED -> PASSED`
- `SKIPPED -> FAILED`
- `SKIPPED -> FAILED -> PASSED`
- Parameterized rows

Each scenario contains several test examples and can be loaded with retry behavior enabled or disabled. Recent ingested runs can be selected from the run history control.

## API

- `POST /api/test-runs/preview` - inspect a JUnit XML report without storing it.
- `POST /api/test-runs` - ingest a JUnit XML report.
- `GET /api/test-runs` - list ingested runs.
- `GET /api/failure-groups` - list confirmed failure groups.
- `GET/PUT /api/retry-config` - read or save project retry settings.
- `POST /api/demo/seed` - load a demo scenario.

The prototype uses in-memory storage. Persistent storage, authentication, deeper framework-specific adapters, and real Jira integration are future work.