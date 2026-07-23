# Architecture

The application is an Express service serving a responsive static dashboard.

## Request flow

1. The dashboard loads `/api/health`, `/api/test-runs`, and `/api/failure-groups`.
2. JUnit XML is uploaded to `/api/test-runs/preview` or `/api/test-runs`.
3. `src/server.ts` validates XML, recursively extracts testcase records from nested suites, preserves reported names and parameters, and creates one logical result per source testcase.
4. Explicit framework metadata selects a registered adapter label; unknown or absent metadata stays on generic JUnit semantics.
5. Failed and error results create exact normalized failure groups.
6. Stored runs and groups are written to Postgres JSONB payload tables when available.
7. Without a usable database, the service remains available with in-memory storage.

## Data contract

The summary exposes total, passed, failed, errors, and skipped counts. A run can be marked failed when it contains either failed tests or errors. No status sequence is interpreted as a retry.

The parser also exposes basic report attributes and `<properties>` values as metadata. Empty but valid reports are accepted as `UNKNOWN` runs with a warning. Framework-specific interpretation remains outside the generic adapter.

## Storage

`afi_runs` stores the public run payload. `afi_failure_groups` stores the group payload. This JSONB model is intentionally temporary; normalization is deferred until the raw result contract and triage workflows stabilize.
