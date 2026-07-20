import { Pool } from "pg";

type StoredState = {
  runs: any[];
  groups: any[];
};

export type Storage = {
  persistent: boolean;
  load: () => Promise<StoredState>;
  saveRun: (run: any) => Promise<void>;
  saveGroup: (group: any) => Promise<void>;
};

export async function createStorage(): Promise<Storage> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("DATABASE_URL is not set; using in-memory storage.");
    return { persistent: false, load: async () => ({ runs: [], groups: [] }), saveRun: async () => undefined, saveGroup: async () => undefined };
  }

  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000, ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false } });
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
  console.log("Using PostgreSQL storage.");
  return {
    persistent: true,
    load: async () => {
      const [runRows, groupRows] = await Promise.all([
        pool.query("SELECT payload FROM afi_runs ORDER BY updated_at DESC"),
        pool.query("SELECT payload FROM afi_failure_groups ORDER BY updated_at DESC")
      ]);
      return { runs: runRows.rows.map(row => row.payload), groups: groupRows.rows.map(row => row.payload) };
    },
    saveRun: async run => { await pool.query("INSERT INTO afi_runs (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [run.id, run]); },
    saveGroup: async group => { await pool.query("INSERT INTO afi_failure_groups (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [group.id, group]); }
  };
}

