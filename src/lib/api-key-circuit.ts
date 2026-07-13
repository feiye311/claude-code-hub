import { logger } from "@/lib/logger";

// key 熔断状态：keyHash -> { until (ms timestamp) }
const circuitOpenForKey = new Map<string, number>();
const KEY_CIRCUIT_OPEN_DURATION_MS = 300_000; // 5 分钟
const MAX_KEY_FAILURES = 3;
const keyFailureCount = new Map<string, number>();

// 活跃连接计数：`${providerId}:${keyIndex}` -> count
const keyConnectionCount = new Map<string, number>();

function hashKey(key: string): string {
  // 取 key 前 8 位 + 长度作为标识，避免暴露完整 key
  return `${key.substring(0, 8)}:${key.length}`;
}

function connKey(providerId: number, keyIndex: number): string {
  return `${providerId}:${keyIndex}`;
}

/**
 * 标记某个 key 调用失败（增加失败计数，达到阈值后熔断）
 */
export function recordKeyFailure(key: string): void {
  const kh = hashKey(key);
  const count = (keyFailureCount.get(kh) ?? 0) + 1;
  keyFailureCount.set(kh, count);

  if (count >= MAX_KEY_FAILURES) {
    circuitOpenForKey.set(kh, Date.now() + KEY_CIRCUIT_OPEN_DURATION_MS);
    logger.warn("[ApiKeyCircuit] Key circuit opened", { keyHash: kh, failures: count });
  } else {
    logger.debug("[ApiKeyCircuit] Key failure recorded", { keyHash: kh, failures: count });
  }
}

/**
 * 标记某个 key 调用成功（重置失败计数和熔断）
 */
export function recordKeySuccess(key: string): void {
  const kh = hashKey(key);
  keyFailureCount.delete(kh);
  circuitOpenForKey.delete(kh);
}

/**
 * 判断某个 key 是否处于熔断状态
 */
export function isKeyCircuitOpen(key: string): boolean {
  const kh = hashKey(key);
  const until = circuitOpenForKey.get(kh);
  if (!until) return false;
  if (Date.now() > until) {
    circuitOpenForKey.delete(kh);
    keyFailureCount.delete(kh);
    return false;
  }
  return true;
}

/**
 * 增加某个 key 的活跃连接计数
 */
export function incrementKeyConnection(providerId: number, keyIndex: number): void {
  const k = connKey(providerId, keyIndex);
  keyConnectionCount.set(k, (keyConnectionCount.get(k) ?? 0) + 1);
}

/**
 * 释放某个 key 的活跃连接计数
 */
export function releaseKeyConnection(providerId: number, keyIndex: number): void {
  const k = connKey(providerId, keyIndex);
  const count = keyConnectionCount.get(k);
  if (count === undefined) return;
  if (count <= 1) {
    keyConnectionCount.delete(k);
  } else {
    keyConnectionCount.set(k, count - 1);
  }
}

/**
 * 获取某个 key 的当前活跃连接数
 */
export function getKeyConnectionCount(providerId: number, keyIndex: number): number {
  return keyConnectionCount.get(connKey(providerId, keyIndex)) ?? 0;
}

/**
 * 从 key 数组中按"最少连接"策略选出一个可用（未熔断）的 key。
 *
 * 遍历所有 key，选择当前活跃连接数最少的未熔断 key，
 * 确保请求均匀分布到各个 key 上。
 *
 * 注意：调用方在确定使用返回的 key 后需调用 incrementKeyConnection，
 * 在请求结束后调用 releaseKeyConnection。
 *
 * 返回 { key, index }，如果没有可用 key 则返回 null。
 */
export function selectAvailableKey(
  keys: string[],
  providerId: number
): { key: string; index: number } | null {
  if (!keys || keys.length === 0) return null;

  let bestIdx = -1;
  let bestCount = Infinity;

  for (let i = 0; i < keys.length; i++) {
    const candidate = keys[i]?.trim();
    if (!candidate) continue;
    if (isKeyCircuitOpen(candidate)) continue;

    const count = getKeyConnectionCount(providerId, i);
    if (count < bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    return { key: keys[bestIdx].trim(), index: bestIdx };
  }

  // 全部熔断：选连接数最少的兜底
  bestCount = Infinity;
  for (let i = 0; i < keys.length; i++) {
    const candidate = keys[i]?.trim();
    if (!candidate) continue;
    const count = getKeyConnectionCount(providerId, i);
    if (count < bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    logger.warn("[ApiKeyCircuit] All keys circuit-open, falling back to least-connections key", {
      providerId,
      fallbackIndex: bestIdx,
      activeConnections: bestCount,
    });
    return { key: keys[bestIdx].trim(), index: bestIdx };
  }

  return null;
}

/**
 * 规范化 key 字段：兼容旧数据的字符串格式
 */
export function normalizeKeys(keyField: unknown): string[] {
  if (Array.isArray(keyField)) {
    return keyField.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  }
  if (typeof keyField === "string" && keyField.trim().length > 0) {
    return [keyField.trim()];
  }
  return [];
}
