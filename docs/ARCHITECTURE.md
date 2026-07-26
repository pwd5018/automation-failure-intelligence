# Architecture

The application is an Express service serving a responsive static dashboard.

## Request flow

1. The dashboard loads `/api/health`, `/api/test-runs`, and `/api/failure-groups`.
2. TestNG JUnit XML is uploaded to `/api/test-runs/preview` or `/api/test-runs` with explicit `sourceType=testng-junit`.
3. `src/server.ts` validates XML, recursively extracts testcase records from nested suites, preserves reported names and parameters, and aggregates explicit TestNG records by `classname#name` plus parameter signature.
4. Explicit framework metadata selects a registered adapter label; unknown or absent metadata stays on generic JUnit semantics.
5. Report quality is evaluated after source records are parsed; accepted reports proceed, warning reports retain actionable issues, and quarantined reports are not ingested.
6. Accepted runs carry explicit source provenance, including source type/name, external run ID, project/build/environment, ingestion timestamp, and content hash.
7. Failed and error results create exact normalized failure groups.
8. During Phase 4, Postgres keeps the existing JSONB run/group payloads as the API compatibility and provenance source while adding indexed run columns and `afi_test_results` source rows.
9. Without a usable database, the service remains available with in-memory storage.
10. Phase 6 result detail reads one logical testcase by run and result ID, returning source evidence and run provenance without exposing the raw XML payload.

## Data contract

The summary exposes logical total, passed, failed, errors, true skipped, flaky, retry, and needs-review counts. A run can be marked failed when it contains either failed tests or errors, and remains `UNKNOWN` when ambiguity requires review. For explicit TestNG input with retry metadata, repeated identities are greedily split into data-provider iterations and ordered attempts: a true skip closes one iteration, `SKIPPED -> ... -> PASSED` is recovered/flaky, and a sequence ending in `FAILED`, `ERROR`, or exhausted `SKIPPED` is failed/error. Raw attempt statuses remain unchanged.

When repeated TestNG identities do not include retry metadata, or a skipped record lacks reliable true-skip/retry evidence, the parser does not guess. It creates one `NEEDS REVIEW` logical group containing every raw record, with observed pass/fail/error/skip counts. The dashboard can filter to these groups and expand their raw attempt history before a future detail surface adds richer iteration inspection.

The parser also exposes basic report attributes and `<properties>` values as metadata. Empty but valid reports remain visible in preview as `UNKNOWN` with a quality quarantine; they are not persisted through the ingestion endpoint. Framework-specific interpretation remains outside the generic adapter.

## Storage

The current `afi_runs` and `afi_failure_groups` JSONB payloads remain intact during the Phase 4 transition. `afi_runs` now has additive normalized metadata columns, and `afi_test_results` stores the future relational source-record seam with indexes for run/order, run/identity, and run/status lookups.

The normalized schema is intentionally additive. New writes populate these columns and rows transactionally, and Postgres-backed reads now reconstruct testcase records and logical tests from normalized rows behind the unchanged API contract. Runs without normalized rows fall back to their stored JSONB payload for compatibility.


## Report quality

`src/reportQuality.ts` classifies parsed reports as `ACCEPTED`, `ACCEPTED_WITH_WARNINGS`, or `QUARANTINED`. It warns on repeated identities and declared-count mismatches, while missing testcase names and empty reports are quarantined. Source records remain literal; only explicit TestNG input with retry metadata enables retry/data-provider aggregation. Preview exposes the quality result; ingestion returns HTTP 422 for quarantined reports before persistence or failure-group creation.


The separate `public/developer.html` workspace runs the Phase 5 API checks without cluttering the product dashboard. It is opened from the main dashboard in a new tab and is intended to grow with future diagnostics.

Phase 6 Slice 1 provides `GET /api/test-runs/:runId/results/:testId` for one reported testcase, keeping the detail contract separate from the lightweight run dashboard. The remaining Phase 6 work is the dashboard detail surface, evidence navigation, and mobile/deployment validation. Phase 7 is reserved for external ingestion and collaboration.

The run provenance is stored in the JSONB payload and additive `afi_runs` columns (`source_type`, `source_name`, `external_run_id`, `content_hash`, and `provenance`) so normalized reads retain the source boundary without changing the API result semantics.
