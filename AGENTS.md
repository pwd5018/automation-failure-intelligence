# Agent Guide

## Purpose

This repository is a private QA-triage sandbox for JUnit test-run reporting.

## Required behavior

- Report source XML literally.
- `PASSED` is passed.
- `FAILED` is failed.
- `ERROR` is error.
- `SKIPPED` is skipped.
- Repeated names are separate results.
- Parameters remain part of result identity.
- Never infer retries or flaky behavior from status order.

## Architecture

- `src/server.ts` owns HTTP routes, JUnit parsing, summaries, and failure grouping.
- `src/storage.ts` owns Postgres initialization and the local memory fallback.
- `public/index.html` is the responsive single-page dashboard.
- `test/fixtures` contains representative and malformed XML reports.
- `test/reporting.test.ts` is the API and parser regression suite.

## Persistence

Vercel uses the first available connection variable among `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, and `POSTGRES_URL_NON_POOLING`. Local tests intentionally run without a database and use memory storage. Never commit or print credentials.

## Validation

Run:

```text
npm test
```

Check the deployed application with `/api/health`. It must report `storage: "postgres"` in Vercel before persistence claims are made.

## Change discipline

- Preserve mobile usability.
- Keep labels aligned with source XML semantics.
- Add a fixture and regression test for new parser behavior.
- Update `ROADMAP.md` when a phase materially changes.
- Do not add retry interpretation without explicit framework metadata.

