import { logger } from "@/lib/logger";
import type { ProviderKey } from "@/repository/provider-keys";

// Circuit state: keyHash -> { until, halfOpenTrials }
interface CircuitState {
  until: number;
  halfOpenTrials: number;
}

// key 熔断状态
const circuitOpenForKey = new Map<string, CircuitState>();
const KEY_CIRCUIT_OPEN_DURATION_MS = 300_000;
const MAX_KEY_FAILURES = 3;
const HALF_OPEN_SUCCESS_THRESHOLD = 2;
const keyFailureCount = new Map<string, number>();

// 活跃连接计数：`${providerId}:${keyId}` -> count
const keyConnectionCount = new Map<string, number>();

function hashKey(key: string): string {
  return `${key.substring(0, 8)}:${key.length}`;
}

function connKey(providerId: number, keyId: number): string {
  return `${providerId}:${keyId}`;
}

export function recordKeyFailure(key: string): void {
  const kh = hashKey(key);
  const count = (keyFailureCount.get(kh) ?? 0) + 1;
  keyFailureCount.set(kh, count);

  if (count >= MAX_KEY_FAILURES) {
    circuitOpenForKey.set(kh, { until: Date.now() + KEY_CIRCUIT_OPEN_DURATION_MS, halfOpenTrials: 0 });
    logger.warn("[ApiKeyCircuit] Key circuit opened", { keyHash: kh, failures: count });
  } else {
    logger.debug("[ApiKeyCircuit] Key failure recorded", { keyHash: kh, failures: count });
  }
}

export function recordKeySuccess(key: string): void {
  const kh = hashKey(key);
  keyFailureCount.delete(kh);
  circuitOpenForKey.delete(kh);
}

export function isKeyCircuitOpen(key: string): boolean {
  const kh = hashKey(key);
  const state = circuitOpenForKey.get(kh);
  if (!state) return false;
  if (Date.now() > state.until) {
    return false;
  }
  return true;
}

export function getKeyCircuitState(key: string): "closed" | "open" | "half-open" {
  const kh = hashKey(key);
  const state = circuitOpenForKey.get(kh);
  if (!state) return "closed";
  if (Date.now() > state.until) return "half-open";
  return "open";
}

export function resetKeyCircuit(key: string): void {
  const kh = hashKey(key);
  circuitOpenForKey.delete(kh);
  keyFailureCount.delete(kh);
  logger.info("[ApiKeyCircuit] Key circuit manually reset", { keyHash: kh });
}

export function getKeyCircuitInfo(key: string): {
  state: "closed" | "open" | "half-open";
  failures: number;
  until?: number;
} {
  const kh = hashKey(key);
  const state = circuitOpenForKey.get(kh);
  const failures = keyFailureCount.get(kh) ?? 0;

  if (!state) return { state: "closed", failures };
  if (Date.now() > state.until) return { state: "half-open", failures };
  return { state: "open", failures, until: state.until };
}

export function incrementKeyConnection(providerId: number, keyId: number): void {
  const k = connKey(providerId, keyId);
  keyConnectionCount.set(k, (keyConnectionCount.get(k) ?? 0) + 1);
}

export function releaseKeyConnection(providerId: number, keyId: number): void {
  const k = connKey(providerId, keyId);
  const count = keyConnectionCount.get(k);
  if (count === undefined) return;
  if (count <= 1) {
    keyConnectionCount.delete(k);
  } else {
    keyConnectionCount.set(k, count - 1);
  }
}

export function getKeyConnectionCount(providerId: number, keyId: number): number {
  return keyConnectionCount.get(connKey(providerId, keyId)) ?? 0;
}

export function selectAvailableKey(
  keys: ProviderKey[],
  providerId: number
): { key: string; keyId: number } | null {
  if (!keys || keys.length === 0) return null;

  const enabledKeys = keys.filter((k) => k.isEnabled && !isKeyCircuitOpen(k.key));

  if (enabledKeys.length > 0) {
    let bestKey: ProviderKey | null = null;
    let bestRatio = Infinity;

    for (const k of enabledKeys) {
      const connections = getKeyConnectionCount(providerId, k.id);
      const ratio = connections / k.weight;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestKey = k;
      }
    }

    if (bestKey) {
      return { key: bestKey.key, keyId: bestKey.id };
    }
  }

  const fallbackKeys = keys.filter((k) => k.isEnabled);
  if (fallbackKeys.length > 0) {
    let bestKey: ProviderKey | null = null;
    let bestRatio = Infinity;

    for (const k of fallbackKeys) {
      const connections = getKeyConnectionCount(providerId, k.id);
      const ratio = connections / k.weight;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestKey = k;
      }
    }

    if (bestKey) {
      logger.warn("[ApiKeyCircuit] All keys circuit-open, falling back to least-ratio key", {
        providerId,
        fallbackKeyId: bestKey.id,
        activeConnections: getKeyConnectionCount(providerId, bestKey.id),
      });
      return { key: bestKey.key, keyId: bestKey.id };
    }
  }

  return null;
}

export function normalizeKeys(keyField: unknown): string[] {
  if (Array.isArray(keyField)) {
    const seen = new Set<string>();
    return keyField.filter((k): k is string => {
      if (typeof k !== "string") return false;
      const trimmed = k.trim();
      if (!trimmed || seen.has(trimmed)) return false;
      seen.add(trimmed);
      return true;
    });
  }
  if (typeof keyField === "string" && keyField.trim().length > 0) {
    return [keyField.trim()];
  }
  return [];
}