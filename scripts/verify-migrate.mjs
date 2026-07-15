import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const dsn = process.env.DSN;
  const queryClient = postgres(dsn);

  const keys = await queryClient`
    SELECT pk.id, pk.provider_id, p.name as provider_name, pk.key, pk.weight, pk.is_enabled
    FROM provider_keys pk
    JOIN providers p ON p.id = pk.provider_id
    ORDER BY pk.provider_id, pk.id
  `;
  console.log("All provider keys:");
  for (const k of keys) {
    console.log(
      `  id=${k.id}, provider=${k.provider_name}(${k.provider_id}), key=${k.key.substring(0, 12)}..., weight=${k.weight}, enabled=${k.is_enabled}`
    );
  }

  await queryClient.end();
}
main();