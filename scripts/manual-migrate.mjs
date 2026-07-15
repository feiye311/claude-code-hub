import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const dsn = process.env.DSN;
  if (!dsn) { console.error("DSN not set"); process.exit(1); }
  const queryClient = postgres(dsn);
  const db = drizzle(queryClient);

  const providers = await queryClient`
    SELECT id, name, key FROM providers WHERE deleted_at IS NULL
  `;
  console.log("Total providers:", providers.length);

  let totalKeys = 0;
  for (const p of providers) {
    const keys = p.key;
    if (Array.isArray(keys) && keys.length > 0) {
      for (const k of keys) {
        if (typeof k === "string" && k.trim()) {
          await queryClient`
            INSERT INTO provider_keys (provider_id, key, weight, is_enabled)
            VALUES (${p.id}, ${k.trim()}, 1, true)
          `;
          totalKeys++;
        }
      }
    }
  }
  console.log("Migrated", totalKeys, "keys");

  const count = await queryClient`SELECT COUNT(*) as c FROM provider_keys`;
  console.log("provider_keys now has", count[0].c);

  await queryClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});