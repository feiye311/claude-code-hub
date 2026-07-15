import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const dsn = process.env.DSN;
  if (!dsn) { console.error("DSN not set"); process.exit(1); }
  const queryClient = postgres(dsn);
  const db = drizzle(queryClient);

  const tables = await queryClient`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE '%provider%'
  `;
  console.log("Provider tables:", tables.map((t) => t.table_name));

  const keys = await queryClient`SELECT * FROM provider_keys`;
  console.log("provider_keys count:", keys.length);

  if (keys.length > 0) {
    console.log("Sample:", JSON.stringify(keys[0], null, 2));
  }

  const providers = await queryClient`
    SELECT id, name, key FROM providers WHERE deleted_at IS NULL LIMIT 3
  `;
  console.log("Providers sample:", providers.length);
  for (const p of providers) {
    console.log("  id:", p.id, "name:", p.name, "keys:", JSON.stringify(p.key));
  }

  await queryClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});