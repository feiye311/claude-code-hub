import type { Context } from "hono";
import { db } from "@/drizzle/db";
import { messageRequest, providers } from "@/drizzle/schema";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { createProblemResponse } from "@/lib/api/v1/_shared/error-envelope";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import { normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

/**
 * 从所有启用的供应商的 allowedModels 中聚合出系统配置的全部模型列表。
 * 仅提取 exact 匹配的规则作为具体模型名（prefix/suffix/regex 等通配规则不产出具体模型名）。
 */
async function getConfiguredModels(): Promise<Map<string, { providerId: number; providerName: string }[]>> {
  const allProviders = await db
    .select({
      id: providers.id,
      name: providers.name,
      isEnabled: providers.isEnabled,
      providerType: providers.providerType,
      allowedModels: providers.allowedModels,
      groupTag: providers.groupTag,
    })
    .from(providers)
    .where(isNull(providers.deletedAt));

  const modelMap = new Map<string, { providerId: number; providerName: string }[]>();

  for (const p of allProviders) {
    if (!p.isEnabled) continue;

    const normalized = normalizeAllowedModelRules(p.allowedModels);
    if (!normalized || normalized.length === 0) {
      // allowedModels 为 null/空表示该供应商允许所有模型（通配），不产出具体模型名
      continue;
    }

    for (const rule of normalized) {
      if (rule.matchType === "exact" && rule.pattern) {
        const existing = modelMap.get(rule.pattern);
        const providerInfo = { providerId: p.id, providerName: p.name };
        if (existing) {
          if (!existing.some((e) => e.providerId === p.id)) {
            existing.push(providerInfo);
          }
        } else {
          modelMap.set(rule.pattern, [providerInfo]);
        }
      }
    }
  }

  return modelMap;
}

/**
 * 获取模型列表（以系统配置的模型为主，附带使用统计）
 */
export async function getModelList(c: Context) {
  const auth = await requireAuth("read")(c, async () => {});
  if (auth instanceof Response) return auth;

  const query = c.req.query();
  const search = query.search?.trim() || undefined;
  const page = parseInt(query.page || "1", 10);
  const pageSize = Math.min(parseInt(query.pageSize || "50", 10), 200);
  const days = parseInt(query.days || "30", 10);

  // 计算时间范围
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    // 1. 获取系统配置的全部模型（来自供应商 allowedModels）
    const configuredModels = await getConfiguredModels();

    // 2. 获取使用统计（按模型名聚合）
    const baseConditions = and(
      isNull(messageRequest.deletedAt),
      isNull(messageRequest.blockedBy),
      gte(messageRequest.createdAt, startDate)
    );

    const usageStats = await db
      .select({
        model: messageRequest.model,
        totalCount: count().as("total_count"),
        successCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 200 AND ${messageRequest.statusCode} < 300 THEN 1 END`
        ).as("success_count"),
        errorCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 400 OR ${messageRequest.statusCode} IS NULL THEN 1 END`
        ).as("error_count"),
        totalInputTokens: sql<string>`COALESCE(SUM(${messageRequest.inputTokens}), 0)`,
        totalOutputTokens: sql<string>`COALESCE(SUM(${messageRequest.outputTokens}), 0)`,
      })
      .from(messageRequest)
      .where(baseConditions)
      .groupBy(messageRequest.model)
      .having(sql`${messageRequest.model} IS NOT NULL`);

    const usageMap = new Map<string, {
      totalCount: number;
      successCount: number;
      errorCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    }>();
    for (const s of usageStats) {
      if (s.model) {
        usageMap.set(s.model, {
          totalCount: Number(s.totalCount),
          successCount: Number(s.successCount),
          errorCount: Number(s.errorCount),
          totalInputTokens: Number(s.totalInputTokens),
          totalOutputTokens: Number(s.totalOutputTokens),
        });
      }
    }

    // 3. 仅显示配置的模型（不合并使用记录中未配置的上游模型 ID）
    const allModelNames = Array.from(configuredModels.keys());

    // 4. 搜索过滤
    let filteredModels = allModelNames;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredModels = filteredModels.filter((m) => m.toLowerCase().includes(lowerSearch));
    }

    // 5. 排序：先按是否有使用记录降序，再按模型名排序
    filteredModels.sort((a, b) => {
      const ua = usageMap.get(a)?.totalCount ?? 0;
      const ub = usageMap.get(b)?.totalCount ?? 0;
      if (ub !== ua) return ub - ua;
      return a.localeCompare(b);
    });

    const total = filteredModels.length;
    const pagedModels = filteredModels.slice((page - 1) * pageSize, page * pageSize);

    // 6. 批量获取分页模型的供应商使用统计（单次查询，避免 N+1）
    const providerStatsByModel = new Map<
      string,
      { providerId: number; providerName: string; count: number }[]
    >();

    if (pagedModels.length > 0) {
      const allProviderStats = await db
        .select({
          model: messageRequest.model,
          providerId: messageRequest.providerId,
          providerName: providers.name,
          count: count().as("count"),
        })
        .from(messageRequest)
        .leftJoin(providers, eq(messageRequest.providerId, providers.id))
        .where(
          and(
            baseConditions,
            inArray(messageRequest.model, pagedModels)
          )
        )
        .groupBy(messageRequest.model, messageRequest.providerId, providers.name)
        .orderBy(desc(count()));

      for (const row of allProviderStats) {
        if (!row.model) continue;
        const arr = providerStatsByModel.get(row.model) ?? [];
        arr.push({
          providerId: row.providerId,
          providerName: row.providerName || `Provider #${row.providerId}`,
          count: Number(row.count),
        });
        providerStatsByModel.set(row.model, arr);
      }
    }

    // 7. 组装最终结果（纯内存操作，无 DB 查询）
    const modelsWithProviders = pagedModels.map((modelName) => {
      const configuredProviders = configuredModels.get(modelName) ?? [];
      const providerStats = providerStatsByModel.get(modelName) ?? [];
      const usage = usageMap.get(modelName);

      // 合并配置的供应商和使用过的供应商（去重）
      const providerMap = new Map<number, { id: number; name: string; count: number }>();
      for (const cp of configuredProviders) {
        providerMap.set(cp.providerId, {
          id: cp.providerId,
          name: cp.providerName,
          count: 0,
        });
      }
      for (const ps of providerStats) {
        const existing = providerMap.get(ps.providerId);
        if (existing) {
          existing.count = ps.count;
        } else {
          providerMap.set(ps.providerId, {
            id: ps.providerId,
            name: ps.providerName,
            count: ps.count,
          });
        }
      }

      return {
        model: modelName,
        totalCount: usage?.totalCount ?? 0,
        successCount: usage?.successCount ?? 0,
        errorCount: usage?.errorCount ?? 0,
        totalInputTokens: usage?.totalInputTokens ?? 0,
        totalOutputTokens: usage?.totalOutputTokens ?? 0,
        providers: Array.from(providerMap.values()),
        providerCount: providerMap.size,
      };
    });

    return jsonResponse({
      data: modelsWithProviders,
      total,
      page,
      pageSize,
      days,
    });
  } catch (error) {
    console.error("[Models] Failed to fetch model list:", error);
    return createProblemResponse({
      status: 500,
      instance: "/api/v1/models",
      errorCode: "internal_error",
      detail: "Failed to fetch model list",
    });
  }
}

/**
 * 获取模型详情（单个模型的供应商和使用统计）
 */
export async function getModelDetail(c: Context) {
  const auth = await requireAuth("read")(c, async () => {});
  if (auth instanceof Response) return auth;

  const modelName = c.req.param("model");
  if (!modelName) {
    return createProblemResponse({
      status: 400,
      instance: "/api/v1/models/detail",
      errorCode: "invalid_request",
      detail: "Model name is required",
    });
  }

  const query = c.req.query();
  const days = parseInt(query.days || "30", 10);

  // 计算时间范围
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    const baseConditions = and(
      isNull(messageRequest.deletedAt),
      eq(messageRequest.model, modelName),
      gte(messageRequest.createdAt, startDate)
    );

    // 获取模型总体统计
    const modelOverview = await db
      .select({
        totalCount: count().as("total_count"),
        successCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 200 AND ${messageRequest.statusCode} < 300 THEN 1 END`
        ).as("success_count"),
        errorCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 400 OR ${messageRequest.statusCode} IS NULL THEN 1 END`
        ).as("error_count"),
        avgDuration: sql<number>`AVG(${messageRequest.durationMs})`,
        totalCost: sql<string>`SUM(${messageRequest.costUsd})`,
        totalInputTokens: sql<string>`SUM(${messageRequest.inputTokens})`,
        totalOutputTokens: sql<string>`SUM(${messageRequest.outputTokens})`,
      })
      .from(messageRequest)
      .where(baseConditions);

    // 获取供应商列表
    const providerStats = await db
      .select({
        providerId: messageRequest.providerId,
        providerName: providers.name,
        providerType: providers.providerType,
        count: count().as("count"),
        successCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 200 AND ${messageRequest.statusCode} < 300 THEN 1 END`
        ).as("success_count"),
        avgDuration: sql<number>`AVG(${messageRequest.durationMs})`,
        totalCost: sql<string>`SUM(${messageRequest.costUsd})`,
      })
      .from(messageRequest)
      .leftJoin(providers, eq(messageRequest.providerId, providers.id))
      .where(baseConditions)
      .groupBy(messageRequest.providerId, providers.name, providers.providerType)
      .orderBy(desc(count()));

    // 获取每日使用趋势
    const dailyTrend = await db
      .select({
        date: sql<string>`DATE(${messageRequest.createdAt})`,
        count: count().as("count"),
        successCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 200 AND ${messageRequest.statusCode} < 300 THEN 1 END`
        ).as("success_count"),
      })
      .from(messageRequest)
      .where(baseConditions)
      .groupBy(sql`DATE(${messageRequest.createdAt})`)
      .orderBy(sql`DATE(${messageRequest.createdAt})`);

    const overview = modelOverview[0];

    return jsonResponse({
      model: modelName,
      overview: {
        totalCount: Number(overview?.totalCount || 0),
        successCount: Number(overview?.successCount || 0),
        errorCount: Number(overview?.errorCount || 0),
        avgDuration: overview?.avgDuration ? Math.round(Number(overview.avgDuration)) : null,
        totalCost: overview?.totalCost || "0",
        totalInputTokens: overview?.totalInputTokens || "0",
        totalOutputTokens: overview?.totalOutputTokens || "0",
      },
      providers: providerStats.map((p) => ({
        id: p.providerId,
        name: p.providerName || `Provider #${p.providerId}`,
        type: p.providerType,
        count: Number(p.count),
        successCount: Number(p.successCount),
        avgDuration: p.avgDuration ? Math.round(Number(p.avgDuration)) : null,
        totalCost: p.totalCost || "0",
      })),
      dailyTrend: dailyTrend.map((d) => ({
        date: d.date,
        count: Number(d.count),
        successCount: Number(d.successCount),
      })),
      days,
    });
  } catch (error) {
    console.error("[Models] Failed to fetch model detail:", error);
    return createProblemResponse({
      status: 500,
      instance: "/api/v1/models/detail",
      errorCode: "internal_error",
      detail: "Failed to fetch model detail",
    });
  }
}
