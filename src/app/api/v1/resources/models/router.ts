import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import { getModelDetail, getModelList } from "./handlers";

export const modelsRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return fromZodError(result.error, new URL(c.req.url).pathname);
  },
});

const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const problemResponses = {
  400: {
    description: "Invalid request.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "Authentication required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "Access denied.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

// 模型列表查询参数
const ModelListQuerySchema = z.object({
  search: z.string().optional().describe("Search model name"),
  page: z.coerce.number().int().min(1).default(1).describe("Page number"),
  pageSize: z.coerce.number().int().min(1).max(200).default(50).describe("Page size"),
  days: z.coerce.number().int().min(1).max(365).default(30).describe("Statistics period in days"),
});

// 模型详情查询参数
const ModelDetailQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30).describe("Statistics period in days"),
});

// 模型供应商 Schema
const ModelProviderSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  count: z.number(),
  successCount: z.number().optional(),
  avgDuration: z.number().nullable().optional(),
  totalCost: z.string().optional(),
});

// 模型列表响应 Schema
const ModelListItemSchema = z.object({
  model: z.string(),
  totalCount: z.number(),
  successCount: z.number(),
  errorCount: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  providers: z.array(ModelProviderSchema),
  providerCount: z.number(),
});

const ModelListResponseSchema = z.object({
  data: z.array(ModelListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  days: z.number(),
});

// 模型详情响应 Schema
const ModelDetailOverviewSchema = z.object({
  totalCount: z.number(),
  successCount: z.number(),
  errorCount: z.number(),
  avgDuration: z.number().nullable(),
  totalCost: z.string(),
  totalInputTokens: z.string(),
  totalOutputTokens: z.string(),
});

const DailyTrendSchema = z.object({
  date: z.string(),
  count: z.number(),
  successCount: z.number(),
});

const ModelDetailResponseSchema = z.object({
  model: z.string(),
  overview: ModelDetailOverviewSchema,
  providers: z.array(
    ModelProviderSchema.extend({
      successCount: z.number(),
      avgDuration: z.number().nullable(),
      totalCost: z.string(),
    })
  ),
  dailyTrend: z.array(DailyTrendSchema),
  days: z.number(),
});

// 获取模型列表
modelsRouter.openapi(
  createRoute({
    method: "get",
    path: "/models",
    middleware: requireAuth("read"),
    tags: ["Models"],
    summary: "Get model list with statistics",
    description: "Returns a paginated list of models with provider and usage statistics.",
    "x-required-access": "read",
    security,
    request: { query: ModelListQuerySchema },
    responses: {
      200: {
        description: "Model list with statistics.",
        content: { "application/json": { schema: ModelListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getModelList as never
);

// 获取模型详情
modelsRouter.openapi(
  createRoute({
    method: "get",
    path: "/models/{model}",
    middleware: requireAuth("read"),
    tags: ["Models"],
    summary: "Get model detail with provider statistics",
    description:
      "Returns detailed statistics for a specific model including provider breakdown and daily trend.",
    "x-required-access": "read",
    security,
    request: {
      params: z.object({
        model: z.string().describe("Model name"),
      }),
      query: ModelDetailQuerySchema,
    },
    responses: {
      200: {
        description: "Model detail with statistics.",
        content: { "application/json": { schema: ModelDetailResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getModelDetail as never
);
