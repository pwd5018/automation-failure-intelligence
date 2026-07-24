import { Pool } from "pg";

type StoredState = {
  runs: any[];
  groups: any[];
};

export type Storage = {
  persistent: boolean;
  variable?: string;
  error?: string;
  load: () => Promise<StoredState>;
  saveRun: (run: any) => Promise<void>;
  saveGroup: (group: any) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
};

function memoryStorage(variable?: string, error?: string): Storage {
  return { persistent: false, variable, error, load: async () => ({ runs: [], groups: [] }), saveRun: async () => undefined, saveGroup: async () => undefined, deleteRun: async () => undefined, deleteGroup: async () => undefined };
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
`;

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
      const [runRows, groupRows] = await Promise.all([
        pool.query("SELECT payload FROM afi_runs ORDER BY updated_at DESC"),
        pool.query("SELECT payload FROM afi_failure_groups ORDER BY updated_at DESC")
      ]);
      return { runs: runRows.rows.map(row => row.payload), groups: groupRows.rows.map(row => row.payload) };
    },
    saveRun: async run => { try { await pool.query("INSERT INTO afi_runs (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [run.id, run]); } catch (error) { console.error("Could not persist run:", error); } },
    saveGroup: async group => { try { await pool.query("INSERT INTO afi_failure_groups (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [group.id, group]); } catch (error) { console.error("Could not persist failure group:", error); } },
    deleteRun: async id => { try { await pool.query("DELETE FROM afi_runs WHERE id = $1", [id]); } catch (error) { console.error("Could not delete demo run:", error); } },
    deleteGroup: async id => { try { await pool.query("DELETE FROM afi_failure_groups WHERE id = $1", [id]); } catch (error) { console.error("Could not delete demo failure group:", error); } }
  };
}
