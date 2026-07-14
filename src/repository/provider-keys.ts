import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerKeys } from "@/drizzle/schema";
import { logger } from "@/lib/logger";

export interface ProviderKey {
  id: number;
  providerId: number;
  key: string;
  name: string | null;
  weight: number;
  isEnabled: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateProviderKeyData {
  providerId: number;
  key: string;
  name?: string | null;
  weight?: number;
  isEnabled?: boolean;
}

export interface UpdateProviderKeyData {
  name?: string | null;
  weight?: number;
  isEnabled?: boolean;
}

const providerKeysCache = new Map<number, { data: ProviderKey[]; expiry: number }>();
const CACHE_TTL = 30_000;

function getCachedKeys(providerId: number): ProviderKey[] | null {
  const cached = providerKeysCache.get(providerId);
  if (cached && Date.now() < cached.expiry) return cached.data;
  providerKeysCache.delete(providerId);
  return null;
}

function setCachedKeys(providerId: number, keys: ProviderKey[]): void {
  providerKeysCache.set(providerId, { data: keys, expiry: Date.now() + CACHE_TTL });
}

export function invalidateKeysCache(providerId: number): void {
  providerKeysCache.delete(providerId);
}

export async function listProviderKeys(providerId: number): Promise<ProviderKey[]> {
  const cached = getCachedKeys(providerId);
  if (cached) return cached;

  const rows = await db
    .select()
    .from(providerKeys)
    .where(and(eq(providerKeys.providerId, providerId), isNull(providerKeys.deletedAt)))
    .orderBy(desc(providerKeys.createdAt));

  const keys: ProviderKey[] = rows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    key: r.key,
    name: r.name,
    weight: r.weight,
    isEnabled: r.isEnabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  setCachedKeys(providerId, keys);
  return keys;
}

export async function getProviderKeyById(id: number): Promise<ProviderKey | null> {
  const rows = await db
    .select()
    .from(providerKeys)
    .where(and(eq(providerKeys.id, id), isNull(providerKeys.deletedAt)))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    providerId: r.providerId,
    key: r.key,
    name: r.name,
    weight: r.weight,
    isEnabled: r.isEnabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createProviderKey(data: CreateProviderKeyData): Promise<ProviderKey> {
  const [row] = await db
    .insert(providerKeys)
    .values({
      providerId: data.providerId,
      key: data.key,
      name: data.name ?? null,
      weight: data.weight ?? 1,
      isEnabled: data.isEnabled ?? true,
    })
    .returning();

  invalidateKeysCache(data.providerId);

  return {
    id: row.id,
    providerId: row.providerId,
    key: row.key,
    name: row.name,
    weight: row.weight,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function updateProviderKey(
  id: number,
  data: UpdateProviderKeyData
): Promise<ProviderKey | null> {
  const existing = await getProviderKeyById(id);
  if (!existing) return null;

  const [row] = await db
    .update(providerKeys)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(providerKeys.id, id))
    .returning();

  invalidateKeysCache(existing.providerId);

  return {
    id: row.id,
    providerId: row.providerId,
    key: row.key,
    name: row.name,
    weight: row.weight,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteProviderKey(id: number): Promise<boolean> {
  const existing = await getProviderKeyById(id);
  if (!existing) return false;

  await db.delete(providerKeys).where(eq(providerKeys.id, id));

  invalidateKeysCache(existing.providerId);
  return true;
}

export async function getProviderKeysByProviderIds(
  providerIds: number[]
): Promise<Map<number, ProviderKey[]>> {
  if (providerIds.length === 0) return new Map();

  const allCached = new Map<number, ProviderKey[]>();
  const uncachedIds: number[] = [];

  for (const pid of providerIds) {
    const cached = getCachedKeys(pid);
    if (cached) {
      allCached.set(pid, cached);
    } else {
      uncachedIds.push(pid);
    }
  }

  if (uncachedIds.length > 0) {
    const rows = await db
      .select()
      .from(providerKeys)
      .where(
        and(
          inArray(providerKeys.providerId, uncachedIds),
          eq(providerKeys.isEnabled, true),
          isNull(providerKeys.deletedAt)
        )
      );

    const grouped = new Map<number, ProviderKey[]>();
    for (const r of rows) {
      const key: ProviderKey = {
        id: r.id,
        providerId: r.providerId,
        key: r.key,
        name: r.name,
        weight: r.weight,
        isEnabled: r.isEnabled,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
      if (!grouped.has(r.providerId)) grouped.set(r.providerId, []);
      grouped.get(r.providerId)!.push(key);
    }

    for (const pid of uncachedIds) {
      const keys = grouped.get(pid) ?? [];
      setCachedKeys(pid, keys);
      allCached.set(pid, keys);
    }
  }

  return allCached;
}