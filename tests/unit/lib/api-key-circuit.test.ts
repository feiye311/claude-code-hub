import { describe, expect, it, beforeEach } from "vitest";
import {
  selectAvailableKey,
  recordKeyFailure,
  recordKeySuccess,
  isKeyCircuitOpen,
  getKeyCircuitState,
  getKeyCircuitInfo,
  resetKeyCircuit,
  incrementKeyConnection,
  releaseKeyConnection,
  getKeyConnectionCount,
} from "@/lib/api-key-circuit";
import type { ProviderKey } from "@/repository/provider-keys";

function makeKey(id: number, weight = 1, isEnabled = true): ProviderKey {
  return {
    id,
    providerId: 1,
    key: `sk-test-${id}`,
    name: null,
    weight,
    isEnabled,
    createdAt: null,
    updatedAt: null,
  };
}

function makeKeyWithKey(id: number, key: string, weight = 1, isEnabled = true): ProviderKey {
  return {
    id,
    providerId: 1,
    key,
    name: null,
    weight,
    isEnabled,
    createdAt: null,
    updatedAt: null,
  };
}

function releaseAllConnections() {
  const keys = ["sk-test-key-a", "sk-test-key-b", "sk-test-key-c"];
  for (const k of keys) {
    resetKeyCircuit(k);
  }
}

describe("api-key-circuit - weight ratio load balancing", () => {
  beforeEach(() => {
    releaseAllConnections();
  });

  it("selects the only key when single key available", () => {
    const keys = [makeKeyWithKey(1, "sk-key-a")];
    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-key-a");
  });

  it("selects key with lower connections when weights are equal", () => {
    const keys = [makeKeyWithKey(1, "sk-key-a"), makeKeyWithKey(2, "sk-key-b")];
    incrementKeyConnection(1, 1);

    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-key-b");
  });

  it("distributes by weight ratio", () => {
    const keys = [makeKeyWithKey(1, "sk-key-a", 1), makeKeyWithKey(2, "sk-key-b", 2)];

    let result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();

    incrementKeyConnection(1, 1);
    result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-key-b");

    incrementKeyConnection(1, 2);
    result = selectAvailableKey(keys, 1);
    expect(result!.key).toBe("sk-key-b");

    incrementKeyConnection(1, 2);
    // key1 ratio=1/1=1.0, key2 ratio=2/2=1.0 - equal, first wins
    result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
  });

  it("skips disabled keys", () => {
    const keys = [makeKeyWithKey(1, "sk-key-a", 1), makeKeyWithKey(2, "sk-key-b", 1, false)];
    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-key-a");
  });

  it("skips circuit-open keys", () => {
    const keys = [makeKeyWithKey(1, "sk-key-a"), makeKeyWithKey(2, "sk-key-b")];
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");

    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-key-b");
  });

  it("falls back when all keys circuit-open", () => {
    const keys = [makeKeyWithKey(1, "sk-key-a"), makeKeyWithKey(2, "sk-key-b")];
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-b");
    recordKeyFailure("sk-key-b");
    recordKeyFailure("sk-key-b");

    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
  });

  it("returns null when no keys available", () => {
    const result = selectAvailableKey([], 1);
    expect(result).toBeNull();
  });
});

describe("api-key-circuit - key-level circuit breaker", () => {
  beforeEach(() => {
    resetKeyCircuit("sk-key-a");
    resetKeyCircuit("sk-key-b");
  });

  it("opens circuit after max failures", () => {
    expect(isKeyCircuitOpen("sk-key-a")).toBe(false);
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    expect(isKeyCircuitOpen("sk-key-a")).toBe(true);
  });

  it("closes circuit on success after circuit open", () => {
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    expect(isKeyCircuitOpen("sk-key-a")).toBe(true);

    recordKeySuccess("sk-key-a");
    expect(isKeyCircuitOpen("sk-key-a")).toBe(false);
  });

  it("getKeyCircuitState returns correct state", () => {
    expect(getKeyCircuitState("sk-key-a")).toBe("closed");

    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    expect(getKeyCircuitState("sk-key-a")).toBe("open");
  });

  it("getKeyCircuitInfo returns failure count", () => {
    const info = getKeyCircuitInfo("sk-key-a");
    expect(info.failures).toBe(0);

    recordKeyFailure("sk-key-a");
    const info2 = getKeyCircuitInfo("sk-key-a");
    expect(info2.failures).toBe(1);
  });

  it("resetKeyCircuit clears circuit state", () => {
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    recordKeyFailure("sk-key-a");
    expect(isKeyCircuitOpen("sk-key-a")).toBe(true);

    resetKeyCircuit("sk-key-a");
    expect(isKeyCircuitOpen("sk-key-a")).toBe(false);
    expect(getKeyCircuitInfo("sk-key-a").failures).toBe(0);
  });
});

describe("api-key-circuit - connection tracking", () => {
  it("increments and releases connections", () => {
    const startCount = getKeyConnectionCount(1, 1);
    incrementKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(startCount + 1);
    incrementKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(startCount + 2);
    releaseKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(startCount + 1);
    releaseKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(startCount);
  });

  it("tracks connections per provider and key independently", () => {
    const before1_1 = getKeyConnectionCount(1, 1);
    const before1_2 = getKeyConnectionCount(1, 2);
    const before2_1 = getKeyConnectionCount(2, 1);
    incrementKeyConnection(1, 1);
    incrementKeyConnection(1, 2);
    incrementKeyConnection(2, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(before1_1 + 1);
    expect(getKeyConnectionCount(1, 2)).toBe(before1_2 + 1);
    expect(getKeyConnectionCount(2, 1)).toBe(before2_1 + 1);
  });
});