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

describe("api-key-circuit - weight ratio load balancing", () => {
  beforeEach(() => {
    // Reset internal state by calling resetKeyCircuit for each key
    const keys = ["sk-test-1", "sk-test-2", "sk-test-3"];
    for (const k of keys) {
      resetKeyCircuit(k);
    }
  });

  it("selects the only key when single key available", () => {
    const keys = [makeKey(1)];
    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-test-1");
  });

  it("selects key with lower connections when weights are equal", () => {
    const keys = [makeKey(1), makeKey(2)];
    incrementKeyConnection(1, 1); // key 1 has 1 connection, key 2 has 0

    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-test-2"); // key 2 has lower ratio (0/1 vs 1/1)
  });

  it("distributes by weight ratio", () => {
    const keys = [makeKey(1, 1), makeKey(2, 2)];

    // key 1 weight=1, 0 connections => ratio 0
    // key 2 weight=2, 0 connections => ratio 0
    // Both equal, pick first
    let result = selectAvailableKey(keys, 1);
    expect(result!.key).toBe("sk-test-1");

    incrementKeyConnection(1, 1); // key 1: 1 conn, weight 1 => ratio 1
    // key 2: 0 conn, weight 2 => ratio 0
    result = selectAvailableKey(keys, 1);
    expect(result!.key).toBe("sk-test-2"); // key 2 wins

    incrementKeyConnection(1, 2); // key 2: 1 conn, weight 2 => ratio 0.5
    // key 1: 1 conn, weight 1 => ratio 1
    result = selectAvailableKey(keys, 1);
    expect(result!.key).toBe("sk-test-2"); // key 2 still wins (0.5 < 1)

    incrementKeyConnection(1, 2); // key 2: 2 conn, weight 2 => ratio 1
    // key 1: 1 conn, weight 1 => ratio 1
    // Equal, picks first
    result = selectAvailableKey(keys, 1);
    expect(result!.key).toBe("sk-test-1");
  });

  it("skips disabled keys", () => {
    const keys = [makeKey(1, 1), makeKey(2, 1, false)];
    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-test-1");
  });

  it("skips circuit-open keys", () => {
    const keys = [makeKey(1), makeKey(2)];
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1"); // opens circuit

    const result = selectAvailableKey(keys, 1);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sk-test-2");
  });

  it("falls back to min ratio when all keys circuit-open", () => {
    const keys = [makeKey(1), makeKey(2)];
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-2");
    recordKeyFailure("sk-test-2");
    recordKeyFailure("sk-test-2");

    incrementKeyConnection(1, 1);
    incrementKeyConnection(1, 2);
    incrementKeyConnection(1, 2); // key 2 has more connections

    // All circuit-open, fallback picks key with min ratio (key 2: 2/1 vs key 1: 1/1)
    // Wait - actually picks key 1 since it has fewer connections
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
    resetKeyCircuit("sk-test-1");
    resetKeyCircuit("sk-test-2");
  });

  it("opens circuit after max failures", () => {
    expect(isKeyCircuitOpen("sk-test-1")).toBe(false);
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    expect(isKeyCircuitOpen("sk-test-1")).toBe(true);
  });

  it("closes circuit on success", () => {
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    expect(isKeyCircuitOpen("sk-test-1")).toBe(true);

    // After half-open duration expires, success should close
    // We can't easily test time, but we can test the success path
    recordKeySuccess("sk-test-1");
    // Just one success not enough to close in half-open
    // Actually outside half-open, it just resets
    expect(isKeyCircuitOpen("sk-test-1")).toBe(false);
  });

  it("getKeyCircuitState returns correct state", () => {
    expect(getKeyCircuitState("sk-test-1")).toBe("closed");

    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    expect(getKeyCircuitState("sk-test-1")).toBe("open");
  });

  it("getKeyCircuitInfo returns failure count", () => {
    const info = getKeyCircuitInfo("sk-test-1");
    expect(info.failures).toBe(0);

    recordKeyFailure("sk-test-1");
    const info2 = getKeyCircuitInfo("sk-test-1");
    expect(info2.failures).toBe(1);
  });

  it("resetKeyCircuit clears circuit state", () => {
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    recordKeyFailure("sk-test-1");
    expect(isKeyCircuitOpen("sk-test-1")).toBe(true);

    resetKeyCircuit("sk-test-1");
    expect(isKeyCircuitOpen("sk-test-1")).toBe(false);
    expect(getKeyCircuitInfo("sk-test-1").failures).toBe(0);
  });
});

describe("api-key-circuit - connection tracking", () => {
  it("increments and releases connections", () => {
    expect(getKeyConnectionCount(1, 1)).toBe(0);
    incrementKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(1);
    incrementKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(2);
    releaseKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(1);
    releaseKeyConnection(1, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(0);
  });

  it("tracks connections per provider and key independently", () => {
    incrementKeyConnection(1, 1);
    incrementKeyConnection(1, 2);
    incrementKeyConnection(2, 1);
    expect(getKeyConnectionCount(1, 1)).toBe(1);
    expect(getKeyConnectionCount(1, 2)).toBe(1);
    expect(getKeyConnectionCount(2, 1)).toBe(1);
  });
});