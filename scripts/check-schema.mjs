import postgres from "postgres";

const dsn = process.env.DSN;
if (!dsn) { console.error("DSN not set"); process.exit(1); }
const sql = postgres(dsn);
const r = await sql`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'provider_keys'
  ORDER BY ordinal_position
`;
console.log("provider_keys schema:");
for (const c of r) {
  console.log(`  ${c.column_name} ${c.data_type} nullable=${c.is_nullable} default=${c.column_default ?? "null"}`);
}
await sql.end();