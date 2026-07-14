import "server-only";

import { eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerKeys, providers } from "@/drizzle/schema";
import { logger } from "@/lib/logger";

export async function migrateProviderKeys(): Promise<void> {
  const existingCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(providerKeys)
    .then((r) => Number(r[0].count));

  if (existingCount > 0) {
    logger.info("[MigrateProviderKeys] provider_keys already has data, skipping migration");
    return;
  }

  const allProviders = await db
    .select({ id: providers.id, key: providers.key })
    .from(providers)
    .where(isNull(providers.deletedAt));

  type KeyArray = string[];
  let totalKeys = 0;

  for (const p of allProviders) {
    const keys = p.key as KeyArray;
    if (!Array.isArray(keys) || keys.length === 0) continue;

    for (const k of keys) {
      if (typeof k !== "string" || !k.trim()) continue;
      await db.insert(providerKeys).values({
        providerId: p.id,
        key: k.trim(),
        weight: 1,
        isEnabled: true,
      });
      totalKeys++;
    }
  }

  logger.info(
    `[MigrateProviderKeys] migrated ${totalKeys} keys for ${allProviders.length} providers`
  );
}