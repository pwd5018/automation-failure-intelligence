# Phase 8 Implementation Plan: TestNG Report Producer Sandbox

## Handoff objective

Build a repository-local fake web application and TestNG producer suite that generates realistic report bundles for Automation Failure Intelligence.

The producer must create both:

1. A master TestNG JUnit XML report.
2. Individual suite/test XML files produced by the same run.

The generated artifacts will be used to understand the real relationship between master and individual reports before implementing multi-file ingestion.

Phase 8 is test infrastructure. It must not become part of the deployed Vercel runtime or change the existing parser/API behavior until the generated artifacts have been inspected and an ingestion design is approved.

## Starting point

- Repository: `C:\Users\wolf-ai\Workspace\automation-failure-intelligence`
- Base branch: `main`
- Current planning commit: `a3bda37`
- Phase 7 UI redesign is implemented and merged.
- Current ingestion accepts one XML file per request and stores it as one run.
- Current dashboard upload path is explicitly TestNG-oriented and sends `sourceType=testng-junit`.
- Current parser preserves raw records and supports explicit TestNG retry/data-provider aggregation.
- Current Postgres storage persists one run in `afi_runs` and one row per raw testcase record in `afi_test_results`.

Read before implementation:

- `AGENTS.md`
- `ROADMAP.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `src/server.ts`
- `src/storage.ts`
- `test/reporting.test.ts`

## Product question this phase must answer

Does the master TestNG result file contain the same testcase-level evidence as the individual files, or do the individual files add important information?

The sandbox must let us compare the files without guessing. It should make differences visible for:

- testcase identity
- class and suite names
- parameters and data-provider values
- status and retry ordering
- failure/error messages and stack traces
- timestamps and durations
- properties and metadata
- attachment/evidence references, if the producer can emit them
- report-level counts

## Proposed repository structure

```text
testng-sandbox/
  app/
    pom.xml
    src/main/java/...              # small fake HTTP application
  tests/
    pom.xml                        # TestNG producer project
    src/test/java/...              # deterministic test cases
  scripts/
    generate-testng-bundle.ps1     # Windows entry point
    compare-testng-reports.ps1     # optional report comparison helper
  README.md
  output/                          # ignored generated bundle output

test/fixtures/
  testng-bundle/
    master-testng-results.xml
    individual/
      ...xml
    manifest.json
```

If Maven module separation creates unnecessary complexity, use one Maven project with `app` and `tests` packages. Keep the boundary clear: the fake app is a producer dependency, not an application runtime dependency.

## Fake application requirements

Create a small deterministic local web/API application with endpoints or pages that exercise realistic automation paths:

- successful login
- rejected login
- locked or disabled account
- delayed response that triggers a retry
- deterministic server error
- data-provider-driven account or role lookup
- a path that produces a skipped test

The fake app may be a minimal Java HTTP server or another local process that TestNG can call. Prefer the smallest implementation that produces meaningful test evidence. Do not introduce a browser automation dependency unless the generated files need browser-specific metadata.

The app must:

- start and stop predictably from the generator command
- bind to a configurable local port
- return deterministic responses
- avoid external network calls
- expose enough detail for failure messages to identify the request and scenario

## TestNG producer requirements

The TestNG suite should deliberately produce the following cases:

| Scenario | Expected output purpose |
| --- | --- |
| Simple pass | Baseline status and duration comparison |
| Simple failure | Failure message and stack comparison |
| Error/exception | Error evidence and classification |
| True skip | Distinguish skip from retry handoff |
| Skip then pass with retry metadata | Validate retry and flaky aggregation |
| Exhausted retry | Validate ordered failed/skipped attempts |
| Data-provider rows | Validate parameter identity and iteration grouping |
| Repeated identity without metadata | Validate `NEEDS REVIEW` behavior |
| Nested suite/test grouping | Validate source hierarchy |
| Multiple suites | Compare master and individual file boundaries |
| Timing variation | Compare report-level and testcase-level durations |

Use explicit TestNG metadata where the current parser requires it, including retry analyzer configuration and data-provider parameters. Also include at least one metadata-poor scenario so the ambiguity behavior remains testable.

The suite must produce stable names and values. Avoid random UUIDs, current timestamps in assertions, network-dependent content, or nondeterministic ordering.

## Required report artifacts

The generator must produce a manifest alongside the XML files. Example:

```json
{
  "bundleId": "phase-8-testng-demo",
  "generatedAt": "...",
  "master": "master-testng-results.xml",
  "individual": [
    "individual/login-suite.xml",
    "individual/data-provider-suite.xml"
  ],
  "scenarios": [
    {
      "name": "retry-skip-then-pass",
      "expectedIdentity": "com.example.LoginTest#retrySkipThenPass",
      "files": ["master-testng-results.xml", "individual/login-suite.xml"]
    }
  ]
}
```

The manifest is a producer aid and must not be treated as authoritative application data. The future ingestion bundle contract must derive and validate provenance from the uploaded files themselves.

## Fixture policy

Generated output should be split into two categories:

### Committed fixtures

Commit a small, representative bundle under `test/fixtures/testng-bundle/` so parser and future bundle-ingestion tests run without Java or Maven installed.

Include:

- master report
- at least two individual reports
- manifest
- one expected comparison summary if useful for regression assertions

### Disposable output

Write full producer output to an ignored `testng-sandbox/output/` directory. Do not commit large build directories, Maven caches, screenshots, or generated logs.

## Comparison tooling

Add a lightweight comparison command that reports, without mutating either source:

- testcase counts per file
- identities found only in master
- identities found only in individual files
- duplicate identities across files
- status conflicts
- evidence differences
- parameter differences
- duration/timestamp differences
- metadata/property differences

Comparison must use a stable identity strategy and must not silently merge records by method name alone. At minimum, compare normalized suite/class/name/parameter identity, while preserving the original source values.

The comparison output should help answer whether the individual reports are:

1. Exact duplicates of master records.
2. Enrichment records for master testcases.
3. Separate records that the master omits.
4. Conflicting records requiring an explicit ingestion policy.

## Implementation slices

### Slice 1: Producer skeleton

- Add the sandbox directories and README.
- Add Maven/TestNG project metadata.
- Add the fake app with start/stop instructions.
- Add the Windows generation script.
- Confirm the producer can run offline after dependencies are available.

### Slice 2: Deterministic TestNG scenarios

- Add pass/fail/error/skip tests.
- Add retry and data-provider scenarios.
- Add nested and multi-suite coverage.
- Ensure output ordering and names are deterministic.

### Slice 3: Master and individual report capture

- Capture the generated master XML.
- Capture individual XML files.
- Write the bundle manifest.
- Keep generated output separate from committed fixtures.

### Slice 4: Comparison report

- Implement the comparison helper.
- Produce a human-readable summary.
- Record findings in `docs/PHASE_8_REPORT_BUNDLE_FINDINGS.md`.
- Identify which fields are authoritative, additive, duplicated, or conflicting.

### Slice 5: Committed regression fixtures

- Select a compact representative bundle.
- Add fixture validation tests.
- Assert that the committed files retain expected identities, statuses, parameters, and evidence.
- Do not implement multi-file ingestion yet unless the comparison findings and data model are clear.

## Guardrails

- Do not change generic JUnit semantics.
- Do not infer retries from status order.
- TestNG retry aggregation is allowed only when explicit TestNG metadata is present.
- Preserve every raw source record.
- Do not deduplicate by method name alone.
- Do not overwrite master evidence with individual evidence.
- Preserve source filename and source order for every future merged record.
- Keep the sandbox outside the Vercel build and production runtime.
- Do not add CI/webhook ingestion, authentication, Jira integration, or manual ambiguity resolution in Phase 8.

## Acceptance criteria

Phase 8 is complete when:

- A documented command starts the fake app and generates the report bundle.
- The bundle contains a master TestNG XML and individual XML files.
- The suite covers pass, failure, error, skip, retry, data-provider, and metadata-poor scenarios.
- Output is deterministic enough for committed regression fixtures.
- The comparison tool clearly identifies duplicates, enrichment, omissions, and conflicts.
- Representative XML and manifest fixtures are committed under `test/fixtures`.
- `npm.cmd test` passes with the new fixture coverage.
- `docs/PHASE_8_REPORT_BUNDLE_FINDINGS.md` records the observed relationship between master and individual files.
- `ROADMAP.md`, `README.md`, and `docs/ARCHITECTURE.md` reflect the final findings.
- No sandbox code is included in the deployed application bundle.

## Suggested validation commands

From the repository root on Windows:

```text
.\testng-sandbox\scripts\generate-testng-bundle.ps1
npm.cmd test
```

Replace the generation command with the final script name once implemented. Also validate the committed fixtures directly so the normal Node test suite does not depend on Java/Maven availability.

## Handoff instruction for the next session

Start by reading `AGENTS.md`, `ROADMAP.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and this file. Inspect the current parser/storage seams before creating the sandbox. Work on a focused remote branch from `main`. Implement Slice 1 first, run the producer once, inspect the actual master and individual XML output, then proceed slice by slice. Do not design multi-file ingestion from assumptions; record observed report differences before changing the product ingestion contract.
