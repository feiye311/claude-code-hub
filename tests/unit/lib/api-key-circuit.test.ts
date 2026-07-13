import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// 用 vi.resetModules 清理模块级 Map 状态
let mod: typeof import("@/lib/api-key-circuit");

beforeEach(async () => {
  vi.resetModules();
  mod = await import("@/lib/api-key-circuit");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api-key-circuit - normalizeKeys", () => {
  test("string 转 string[]（向后兼容旧数据）", () => {
    expect(mod.normalizeKeys("sk-abc123")).toEqual(["sk-abc123"]);
  });

  test("string[] 原样保留（过滤空串和非法值）", () => {
    expect(mod.normalizeKeys(["sk-1", "sk-2", "", "  ", 123 as unknown as string])).toEqual([
      "sk-1",
      "sk-2",
    ]);
  });

  test("null / undefined / 空字符串 返回空数组", () => {
    expect(mod.normalizeKeys(null)).toEqual([]);
    expect(mod.normalizeKeys(undefined)).toEqual([]);
    expect(mod.normalizeKeys("")).toEqual([]);
    expect(mod.normalizeKeys("   ")).toEqual([]);
  });
});

describe("api-key-circuit - selectAvailableKey 最少连接策略", () => {
  test("空数组返回 null", () => {
    expect(mod.selectAvailableKey([], 1)).toBeNull();
  });

  test("单 key 直接返回", () => {
    const result = mod.selectAvailableKey(["sk-1"], 1);
    expect(result).toEqual({ key: "sk-1", index: 0 });
  });

  test("多个 key 且无活跃连接时选第一个", () => {
    const result = mod.selectAvailableKey(["sk-1", "sk-2", "sk-3"], 1);
    expect(result?.index).toBe(0);
  });

  test("选连接数最少的 key", () => {
    const providerId = 100;
    // key[0] 有 3 个活跃连接, key[1] 有 0 个, key[2] 有 1 个
    mod.incrementKeyConnection(providerId, 0);
    mod.incrementKeyConnection(providerId, 0);
    mod.incrementKeyConnection(providerId, 0);
    mod.incrementKeyConnection(providerId, 2);

    const result = mod.selectAvailableKey(["sk-1", "sk-2", "sk-3"], providerId);
    expect(result?.index).toBe(1); // key[1] 连接数最少
    expect(result?.key).toBe("sk-2");
  });

  test("连接数相同时选第一个", () => {
    const providerId = 101;
    // 所有 key 连接数都为 0
    const result = mod.selectAvailableKey(["sk-a", "sk-b"], providerId);
    expect(result?.index).toBe(0);
  });

  test("跳过已熔断的 key", () => {
    const providerId = 102;
    // 让 key[0] 熔断
    mod.recordKeyFailure("sk-1");
    mod.recordKeyFailure("sk-1");
    mod.recordKeyFailure("sk-1"); // 第 3 次失败 → 熔断

    const result = mod.selectAvailableKey(["sk-1", "sk-2"], providerId);
    expect(result?.index).toBe(1); // 跳过熔断的 key[0]
    expect(result?.key).toBe("sk-2");
  });

  test("全部熔断时选连接数最少的兜底", () => {
    const providerId = 103;
    // 让所有 key 熔断
    for (let i = 0; i < 3; i++) {
      mod.recordKeyFailure("sk-1");
      mod.recordKeyFailure("sk-2");
    }
    // key[1] 连接数更少
    mod.incrementKeyConnection(providerId, 0);
    mod.incrementKeyConnection(providerId, 0);

    const result = mod.selectAvailableKey(["sk-1", "sk-2"], providerId);
    expect(result?.index).toBe(1); // 连接数更少的 key
  });

  test("不同 providerId 的连接计数互不影响", () => {
    // provider 1 的 key[0] 有连接
    mod.incrementKeyConnection(1, 0);
    mod.incrementKeyConnection(1, 0);

    // provider 2 的 key[0] 无连接
    const result = mod.selectAvailableKey(["sk-a", "sk-b"], 2);
    expect(result?.index).toBe(0); // provider 2 的 key[0] 连接数为 0，应选它
  });
});

describe("api-key-circuit - increment/release 连接计数", () => {
  test("increment 后 getKeyConnectionCount 正确反映", () => {
    mod.incrementKeyConnection(1, 0);
    mod.incrementKeyConnection(1, 0);
    expect(mod.getKeyConnectionCount(1, 0)).toBe(2);
  });

  test("release 后计数递减", () => {
    mod.incrementKeyConnection(1, 0);
    mod.incrementKeyConnection(1, 0);
    mod.releaseKeyConnection(1, 0);
    expect(mod.getKeyConnectionCount(1, 0)).toBe(1);
  });

  test("release 到 0 后清除", () => {
    mod.incrementKeyConnection(1, 0);
    mod.releaseKeyConnection(1, 0);
    expect(mod.getKeyConnectionCount(1, 0)).toBe(0);
  });

  test("release 未 increment 的 key 不报错", () => {
    expect(() => mod.releaseKeyConnection(1, 0)).not.toThrow();
    expect(mod.getKeyConnectionCount(1, 0)).toBe(0);
  });

  test("release 不会让计数变为负数", () => {
    mod.incrementKeyConnection(1, 0);
    mod.releaseKeyConnection(1, 0);
    mod.releaseKeyConnection(1, 0); // 多 release 一次
    expect(mod.getKeyConnectionCount(1, 0)).toBe(0);
  });
});

describe("api-key-circuit - 熔断机制", () => {
  test("失败 3 次后 key 被熔断", () => {
    const key = "sk-fail";
    expect(mod.isKeyCircuitOpen(key)).toBe(false);

    mod.recordKeyFailure(key);
    mod.recordKeyFailure(key);
    expect(mod.isKeyCircuitOpen(key)).toBe(false); // 2 次还没熔断

    mod.recordKeyFailure(key); // 第 3 次
    expect(mod.isKeyCircuitOpen(key)).toBe(true);
  });

  test("成功后重置熔断状态", () => {
    const key = "sk-success";
    mod.recordKeyFailure(key);
    mod.recordKeyFailure(key);
    mod.recordKeyFailure(key); // 熔断
    expect(mod.isKeyCircuitOpen(key)).toBe(true);

    mod.recordKeySuccess(key);
    expect(mod.isKeyCircuitOpen(key)).toBe(false);
  });

  test("不同 key 的熔断状态独立", () => {
    mod.recordKeyFailure("sk-1");
    mod.recordKeyFailure("sk-1");
    mod.recordKeyFailure("sk-1"); // sk-1 熔断

    expect(mod.isKeyCircuitOpen("sk-1")).toBe(true);
    expect(mod.isKeyCircuitOpen("sk-2")).toBe(false);
  });

  test("熔断 5 分钟后自动恢复", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const key = "sk-timeout";
    mod.recordKeyFailure(key);
    mod.recordKeyFailure(key);
    mod.recordKeyFailure(key); // 熔断 5 分钟
    expect(mod.isKeyCircuitOpen(key)).toBe(true);

    // 快进 4 分钟
    vi.setSystemTime(new Date("2026-01-01T00:04:00.000Z"));
    expect(mod.isKeyCircuitOpen(key)).toBe(true); // 还在熔断

    // 快进 5 分零 1 秒
    vi.setSystemTime(new Date("2026-01-01T00:05:01.000Z"));
    expect(mod.isKeyCircuitOpen(key)).toBe(false); // 熔断过期

    vi.useRealTimers();
  });
});
