import { Pool } from "pg";
import crypto from "node:crypto";

type StoredState = {
  runs: any[];
  groups: any[];
  dispositions: any[];
  retryConfigs: any[];
};

export type Storage = {
  persistent: boolean;
  variable?: string;
  error?: string;
  load: () => Promise<StoredState>;
  saveRun: (run: any) => Promise<void>;
  saveGroup: (group: any) => Promise<void>;
  saveDisposition: (disposition: any) => Promise<void>;
  saveRetryConfig: (config: any) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
};

function memoryStorage(variable?: string, error?: string): Storage {
  return { persistent: false, variable, error, load: async () => ({ runs: [], groups: [], dispositions: [], retryConfigs: [] }), saveRun: async () => undefined, saveGroup: async () => undefined, saveDisposition: async () => undefined, saveRetryConfig: async () => undefined, deleteRun: async () => undefined, deleteGroup: async () => undefined };
}

function connectionStringForNode(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    return value.replace(/([?&])sslmode=[^&]*&?/i, "$1").replace(/[?&]$/, "");
  }
}

function jsonValue(value: unknown): string { return JSON.stringify(value ?? null); }

const normalizedSchemaSql = `
  -- Phase 4 is additive: the JSONB payload remains the compatibility and
  -- provenance source while normalized columns and testcase rows are introduced.
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS project_id TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS build TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS environment TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS adapter TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS adapter_version TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS result_status TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS processing_status TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS raw_report TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS report_metadata JSONB;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS warnings JSONB;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS summary JSONB;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS source_type TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS source_name TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS external_run_id TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS content_hash TEXT;
  ALTER TABLE afi_runs ADD COLUMN IF NOT EXISTS provenance JSONB;

  CREATE INDEX IF NOT EXISTS afi_runs_project_id_idx ON afi_runs (project_id);
  CREATE INDEX IF NOT EXISTS afi_runs_result_status_idx ON afi_runs (result_status);
  CREATE INDEX IF NOT EXISTS afi_runs_ingested_at_idx ON afi_runs (ingested_at DESC);

  CREATE TABLE IF NOT EXISTS afi_test_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES afi_runs(id) ON DELETE CASCADE,
    source_order INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    identity TEXT NOT NULL,
    suite TEXT NOT NULL,
    class_name TEXT NOT NULL,
    test_name TEXT NOT NULL,
    parameters TEXT,
    raw_status TEXT NOT NULL,
    message TEXT,
    stack_trace TEXT,
    duration TEXT,
    reported_timestamp TEXT NOT NULL,
    raw_record JSONB NOT NULL,
    UNIQUE (run_id, source_order)
  );

  CREATE INDEX IF NOT EXISTS afi_test_results_run_order_idx
    ON afi_test_results (run_id, source_order);
  CREATE INDEX IF NOT EXISTS afi_test_results_run_identity_idx
    ON afi_test_results (run_id, identity);
  CREATE INDEX IF NOT EXISTS afi_test_results_run_status_idx
    ON afi_test_results (run_id, raw_status);

  CREATE TABLE IF NOT EXISTS afi_result_dispositions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES afi_runs(id) ON DELETE CASCADE,
    test_id TEXT NOT NULL,
    test_identity TEXT NOT NULL,
    failure_signature TEXT,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, test_id)
  );

  CREATE INDEX IF NOT EXISTS afi_result_dispositions_identity_idx
    ON afi_result_dispositions (test_identity, failure_signature);

  CREATE TABLE IF NOT EXISTS afi_failure_group_occurrences (
    group_id TEXT NOT NULL REFERENCES afi_failure_groups(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    test_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    outcome TEXT NOT NULL,
    build TEXT NOT NULL,
    environment TEXT NOT NULL,
    PRIMARY KEY (group_id, run_id, test_id)
  );

  CREATE INDEX IF NOT EXISTS afi_failure_group_occurrences_run_idx
    ON afi_failure_group_occurrences (run_id, group_id);

  CREATE TABLE IF NOT EXISTS afi_retry_configs (
    project_id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

function groupPayload(group: any): string {
  const { evidence: _evidence, runs: _runs, tests: _tests, testIds: _testIds, ...bounded } = group;
  return jsonValue(bounded);
}

function hydrateGroup(payload: any, occurrenceRows: any[]): any {
  if (!occurrenceRows.length) return payload;
  const evidence = occurrenceRows.map(row => ({ runId: row.run_id, testId: row.test_id, testName: row.test_name, outcome: row.outcome, build: row.build, environment: row.environment }));
  return {
    ...payload,
    runs: [...new Set(evidence.map(item => item.runId))],
    tests: [...new Set(evidence.map(item => item.testName))],
    testIds: [...new Set(evidence.map(item => item.testId))],
    evidence,
    occurrences: evidence.length
  };
}

function valuesSql(rows: unknown[][]): { text: string; values: unknown[] } {
  const values = rows.flat();
  const placeholders = rows.map((row, rowIndex) => `(${row.map((_, columnIndex) => `$${rowIndex * row.length + columnIndex + 1}`).join(", ")})`).join(", ");
  return { text: placeholders, values };
}

function hydrateRunFromNormalizedRows(runRow: any, resultRows: any[]): any {
  const payload = runRow.payload || {};
  const rawRecords = resultRows.map(row => ({
    id: row.source_id,
    order: row.source_order,
    suite: row.suite,
    className: row.class_name,
    testName: row.test_name,
    identity: row.identity,
    ...(row.parameters == null ? {} : { parameters: row.parameters }),
    rawStatus: row.raw_status,
    ...(row.message == null ? {} : { message: row.message }),
    ...(row.stack_trace == null ? {} : { stackTrace: row.stack_trace }),
    ...(row.duration == null ? {} : { duration: row.duration }),
    timestamp: row.reported_timestamp
  }));
  const logicalTests = rawRecords.map(record => ({
    id: `test_${crypto.createHash("sha1").update(record.id).digest("hex").slice(0, 12)}`,
    identity: record.identity,
    name: record.testName,
    suite: record.suite,
    className: record.className,
    ...(record.parameters === undefined ? {} : { parameters: record.parameters }),
    attempts: [{ ...record, attemptNumber: 1, status: record.rawStatus.toLowerCase() }],
    finalStatus: record.rawStatus.toLowerCase(),
    retryCount: 0,
    flaky: false,
    recoveredAfterRetry: false
  }));
  return {
    ...payload,
    id: runRow.id,
    projectId: runRow.project_id ?? payload.projectId,
    build: runRow.build ?? payload.build,
    environment: runRow.environment ?? payload.environment,
    adapter: runRow.adapter ?? payload.adapter,
    adapterVersion: runRow.adapter_version ?? payload.adapterVersion,
    ingestedAt: runRow.ingested_at?.toISOString?.() ?? payload.ingestedAt,
    rawReport: runRow.raw_report ?? payload.rawReport,
    reportMetadata: runRow.report_metadata ?? payload.reportMetadata,
    warnings: runRow.warnings ?? payload.warnings,
    summary: runRow.summary ?? payload.summary,
    resultStatus: runRow.result_status ?? payload.resultStatus,
    processingStatus: runRow.processing_status ?? payload.processingStatus,
    provenance: runRow.provenance ?? payload.provenance,
    rawRecords,
    logicalTests: payload.logicalTests || logicalTests
  };
}

export async function createStorage(): Promise<Storage> {
  const candidates = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"];
  const variable = candidates.find(name => Boolean(process.env[name]));
  const connectionString = variable ? process.env[variable] : undefined;
  if (!connectionString) {
    console.log("No PostgreSQL connection variable is set; using in-memory storage.");
    return memoryStorage();
  }

  const pool = new Pool({ connectionString: connectionStringForNode(connectionString), max: 2, connectionTimeoutMillis: 5000, ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS afi_runs (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS afi_failure_groups (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(normalizedSchemaSql);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PostgreSQL initialization error";
    console.error(`PostgreSQL initialization failed using ${variable}; using in-memory storage:`, error);
    await pool.end().catch(() => undefined);
    return memoryStorage(variable, message);
  }
  console.log("Using PostgreSQL storage.");
  return {
    persistent: true,
    variable,
    load: async () => {
      const [runRows, resultRows, groupRows, occurrenceRows, dispositionRows, retryConfigRows] = await Promise.all([
        pool.query(`SELECT id, payload, project_id, build, environment, adapter, adapter_version,
                           result_status, processing_status, ingested_at, raw_report,
                           report_metadata, warnings, summary,
                           source_type, source_name, external_run_id, content_hash, provenance
                    FROM afi_runs ORDER BY updated_at DESC`),
        pool.query(`SELECT id, run_id, source_order, source_id, identity, suite, class_name,
                           test_name, parameters, raw_status, message, stack_trace,
                           duration, reported_timestamp
                    FROM afi_test_results ORDER BY run_id, source_order`),
        pool.query("SELECT payload FROM afi_failure_groups ORDER BY updated_at DESC"),
        pool.query(`SELECT group_id, run_id, test_id, test_name, outcome, build, environment
                    FROM afi_failure_group_occurrences
                    ORDER BY group_id, run_id, test_id`),
        pool.query("SELECT payload FROM afi_result_dispositions ORDER BY updated_at DESC"),
        pool.query("SELECT payload FROM afi_retry_configs ORDER BY updated_at DESC")
      ]);
      const resultsByRun = new Map<string, any[]>();
      for (const row of resultRows.rows) {
        const rows = resultsByRun.get(row.run_id) || [];
        rows.push(row);
        resultsByRun.set(row.run_id, rows);
      }
      const occurrencesByGroup = new Map<string, any[]>();
      for (const row of occurrenceRows.rows) {
        const rows = occurrencesByGroup.get(row.group_id) || [];
        rows.push(row);
        occurrencesByGroup.set(row.group_id, rows);
      }
      return {
        runs: runRows.rows.map(row => {
          const normalizedRows = resultsByRun.get(row.id) || [];
          return normalizedRows.length ? hydrateRunFromNormalizedRows(row, normalizedRows) : row.payload;
        }),
        groups: groupRows.rows.map(row => hydrateGroup(row.payload, occurrencesByGroup.get(row.payload.id) || [])),
        dispositions: dispositionRows.rows.map(row => row.payload),
        retryConfigs: retryConfigRows.rows.map(row => row.payload)
      };
    },
    saveRun: async run => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO afi_runs
             (id, payload, project_id, build, environment, adapter, adapter_version,
              result_status, processing_status, ingested_at, raw_report,
              report_metadata, warnings, summary, source_type, source_name,
              external_run_id, content_hash, provenance, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
           ON CONFLICT (id) DO UPDATE SET
             payload = EXCLUDED.payload,
             project_id = EXCLUDED.project_id,
             build = EXCLUDED.build,
             environment = EXCLUDED.environment,
             adapter = EXCLUDED.adapter,
             adapter_version = EXCLUDED.adapter_version,
             result_status = EXCLUDED.result_status,
             processing_status = EXCLUDED.processing_status,
             ingested_at = EXCLUDED.ingested_at,
             raw_report = EXCLUDED.raw_report,
             report_metadata = EXCLUDED.report_metadata,
             warnings = EXCLUDED.warnings,
             summary = EXCLUDED.summary,
             source_type = EXCLUDED.source_type,
             source_name = EXCLUDED.source_name,
             external_run_id = EXCLUDED.external_run_id,
             content_hash = EXCLUDED.content_hash,
             provenance = EXCLUDED.provenance,
             updated_at = NOW()`,
          [run.id, jsonValue(run), run.projectId, run.build, run.environment, run.adapter, run.adapterVersion, run.resultStatus, run.processingStatus, run.ingestedAt, run.rawReport, jsonValue(run.reportMetadata), jsonValue(run.warnings), jsonValue(run.summary), run.provenance?.sourceType || null, run.provenance?.sourceName || null, run.provenance?.externalRunId || null, run.provenance?.contentHash || null, jsonValue(run.provenance)]
        );
        await client.query("DELETE FROM afi_test_results WHERE run_id = $1", [run.id]);
        const records = run.rawRecords || [];
        for (let start = 0; start < records.length; start += 250) {
          const chunk = records.slice(start, start + 250);
          const rows = chunk.map((record: any) => [
            `${run.id}:${record.id}`, run.id, record.order, record.id, record.identity, record.suite, record.className,
            record.testName, record.parameters || null, record.rawStatus, record.message || null, record.stackTrace || null,
            record.duration || null, record.timestamp, jsonValue(record)
          ]);
          const statement = valuesSql(rows);
          await client.query(
            `INSERT INTO afi_test_results
               (id, run_id, source_order, source_id, identity, suite, class_name,
                test_name, parameters, raw_status, message, stack_trace, duration,
                reported_timestamp, raw_record)
             VALUES ${statement.text}`,
            statement.values
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    saveGroup: async group => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO afi_failure_groups (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [group.id, groupPayload(group)]);
        await client.query("DELETE FROM afi_failure_group_occurrences WHERE group_id = $1", [group.id]);
        const evidence = group.evidence || [];
        for (let start = 0; start < evidence.length; start += 250) {
          const rows = evidence.slice(start, start + 250).map((item: any) => [group.id, item.runId, item.testId, item.testName, item.outcome, item.build, item.environment]);
          const statement = valuesSql(rows);
          await client.query(`INSERT INTO afi_failure_group_occurrences (group_id, run_id, test_id, test_name, outcome, build, environment) VALUES ${statement.text}`, statement.values);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    saveDisposition: async disposition => {
      await pool.query("INSERT INTO afi_result_dispositions (id, run_id, test_id, test_identity, failure_signature, payload, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (run_id, test_id) DO UPDATE SET test_identity = EXCLUDED.test_identity, failure_signature = EXCLUDED.failure_signature, payload = EXCLUDED.payload, updated_at = NOW()", [disposition.id, disposition.runId, disposition.testId, disposition.testIdentity, disposition.failureSignature || null, jsonValue(disposition)]);
    },
    saveRetryConfig: async config => {
      await pool.query("INSERT INTO afi_retry_configs (project_id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [config.projectId, jsonValue(config)]);
    },
    deleteRun: async id => { await pool.query("DELETE FROM afi_runs WHERE id = $1", [id]); },
    deleteGroup: async id => { await pool.query("DELETE FROM afi_failure_groups WHERE id = $1", [id]); }
  };
}
