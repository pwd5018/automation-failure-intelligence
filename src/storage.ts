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

