import type { Context } from "hono";
import { db } from "@/drizzle/db";
import { messageRequest, providers } from "@/drizzle/schema";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { createProblemResponse } from "@/lib/api/v1/_shared/error-envelope";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import { and, count, desc, eq, gte, ilike, isNull, sql } from "drizzle-orm";

/**
 * 获取模型列表（带统计信息）
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
    // 构建基础查询条件
    const baseConditions = and(
      isNull(messageRequest.deletedAt),
      isNull(messageRequest.blockedBy),
      gte(messageRequest.createdAt, startDate)
    );

    // 如果有搜索条件，添加模型名称过滤
    const searchCondition = search
      ? and(baseConditions, ilike(messageRequest.model, `%${search}%`))
      : baseConditions;

    // 获取模型列表（按模型名称聚合）
    const modelStats = await db
      .select({
        model: messageRequest.model,
        totalCount: count().as("total_count"),
        successCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 200 AND ${messageRequest.statusCode} < 300 THEN 1 END`
        ).as("success_count"),
        errorCount: count(
          sql`CASE WHEN ${messageRequest.statusCode} >= 400 OR ${messageRequest.statusCode} IS NULL THEN 1 END`
        ).as("error_count"),
      })
      .from(messageRequest)
      .where(searchCondition)
      .groupBy(messageRequest.model)
      .having(sql`${messageRequest.model} IS NOT NULL`)
      .orderBy(desc(count()))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // 获取总数
    const totalResult = await db
      .select({
        count: sql<number>`COUNT(DISTINCT ${messageRequest.model})`,
      })
      .from(messageRequest)
      .where(searchCondition);

    const total = totalResult[0]?.count || 0;

    // 为每个模型获取供应商信息
    const modelsWithProviders = await Promise.all(
      modelStats
        .filter((m) => m.model)
        .map(async (modelStat) => {
          // 获取该模型的供应商列表
          const providerStats = await db
            .select({
              providerId: messageRequest.providerId,
              providerName: providers.name,
              count: count().as("count"),
            })
            .from(messageRequest)
            .leftJoin(providers, eq(messageRequest.providerId, providers.id))
            .where(
              and(
                baseConditions,
                eq(messageRequest.model, modelStat.model!)
              )
            )
            .groupBy(messageRequest.providerId, providers.name)
            .orderBy(desc(count()));

          return {
            model: modelStat.model,
            totalCount: Number(modelStat.totalCount),
            successCount: Number(modelStat.successCount),
            errorCount: Number(modelStat.errorCount),
            providers: providerStats.map((p) => ({
              id: p.providerId,
              name: p.providerName || `Provider #${p.providerId}`,
              count: Number(p.count),
            })),
            providerCount: providerStats.length,
          };
        })
    );

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
