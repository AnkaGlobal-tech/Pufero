import { loadEnvFile } from "./load-env.mjs";
import pg from "pg";

loadEnvFile();

const url = process.env.SUPABASE_DB_URL;

if (!url) {
  console.error("❌ SUPABASE_DB_URL eksik (.env)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const { rows } = await client.query(
    "SELECT count(*)::int AS stores FROM stores",
  );
  console.log(`✅ Postgres baglantisi OK (${rows[0].stores} store)`);
} catch (error) {
  console.error(
    "❌ Postgres baglanti hatasi:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
} finally {
  await client.end();
}
