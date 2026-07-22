# Architecture

The application is an Express service serving a responsive static dashboard.

## Request flow

1. The dashboard loads `/api/health`, `/api/test-runs`, and `/api/failure-groups`.
2. JUnit XML is uploaded to `/api/test-runs/preview` or `/api/test-runs`.
3. `src/server.ts` validates XML, extracts testcase records, and creates one logical result per source testcase.
4. Failed and error results create exact normalized failure groups.
5. Stored runs and groups are written to Postgres JSONB payload tables when available.
6. Without a usable database, the service remains available with in-memory storage.

## Data contract

The summary exposes total, passed, failed, errors, and skipped counts. A run can be marked failed when it contains either failed tests or errors. No status sequence is interpreted as a retry.

## Storage

`afi_runs` stores the public run payload. `afi_failure_groups` stores the group payload. This JSONB model is intentionally temporary; normalization is deferred until the raw result contract and triage workflows stabilize.

