# Architecture

The application is an Express service serving a responsive static dashboard.

## Request flow

1. The dashboard loads `/api/health`, `/api/test-runs`, and `/api/failure-groups`.
2. JUnit XML is uploaded to `/api/test-runs/preview` or `/api/test-runs`.
3. `src/server.ts` validates XML, recursively extracts testcase records from nested suites, preserves reported names and parameters, and creates one logical result per source testcase.
4. Explicit framework metadata selects a registered adapter label; unknown or absent metadata stays on generic JUnit semantics.
5. Failed and error results create exact normalized failure groups.
6. During Phase 4, Postgres keeps the existing JSONB run/group payloads as the API compatibility and provenance source while adding indexed run columns and `afi_test_results` source rows.
7. Without a usable database, the service remains available with in-memory storage.

## Data contract

The summary exposes total, passed, failed, errors, and skipped counts. A run can be marked failed when it contains either failed tests or errors. No status sequence is interpreted as a retry.

The parser also exposes basic report attributes and `<properties>` values as metadata. Empty but valid reports are accepted as `UNKNOWN` runs with a warning. Framework-specific interpretation remains outside the generic adapter.

## Storage

The current `afi_runs` and `afi_failure_groups` JSONB payloads remain intact during the Phase 4 transition. `afi_runs` now has additive normalized metadata columns, and `afi_test_results` stores the future relational source-record seam with indexes for run/order, run/identity, and run/status lookups.

The normalized schema is intentionally additive. Subsequent Phase 4 slices will populate these columns and rows transactionally, then move reads behind the unchanged API contract after equivalence is demonstrated.
