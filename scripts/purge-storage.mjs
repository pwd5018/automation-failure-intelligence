import pg from "pg";

const { Pool } = pg;
const candidates = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"];
const variable = candidates.find(name => process.env[name]);

if (!variable) {
  console.error("No PostgreSQL connection variable is set. Refusing to purge storage.");
  process.exit(1);
}

function connectionStringForNode(value) {
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

const pool = new Pool({
  connectionString: connectionStringForNode(process.env[variable]),
  max: 1,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false }
});

try {
  const before = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM afi_runs) AS runs,
      (SELECT COUNT(*)::int FROM afi_test_results) AS test_results,
      (SELECT COUNT(*)::int FROM afi_failure_groups) AS failure_groups
  `);
  const counts = before.rows[0];
  console.log(`Storage ${variable}: ${counts.runs} runs, ${counts.test_results} testcase rows, ${counts.failure_groups} failure groups.`);

  if (process.env.PURGE_CONFIRM !== "DELETE_ALL_AFI_DATA") {
    console.log("Dry run only. Set PURGE_CONFIRM=DELETE_ALL_AFI_DATA to delete all three datasets.");
  } else {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM afi_failure_groups");
      await client.query("DELETE FROM afi_runs");
      await client.query("COMMIT");
      console.log(`Purged ${counts.runs} runs, ${counts.test_results} testcase rows, and ${counts.failure_groups} failure groups.`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
