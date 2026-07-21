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
};

function memoryStorage(variable?: string, error?: string): Storage {
  return { persistent: false, variable, error, load: async () => ({ runs: [], groups: [] }), saveRun: async () => undefined, saveGroup: async () => undefined };
}

export async function createStorage(): Promise<Storage> {
  const candidates = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"];
  const variable = candidates.find(name => Boolean(process.env[name]));
  const connectionString = variable ? process.env[variable] : undefined;
  if (!connectionString) {
    console.log("No PostgreSQL connection variable is set; using in-memory storage.");
    return memoryStorage();
  }

  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000, ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false } });
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
    saveGroup: async group => { try { await pool.query("INSERT INTO afi_failure_groups (id, payload, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()", [group.id, group]); } catch (error) { console.error("Could not persist failure group:", error); } }
  };
}

