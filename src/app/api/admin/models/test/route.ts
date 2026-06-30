import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import {
  getProviderModelRedirectTarget,
  hasProviderModelRedirectRules,
  normalizeProviderModelRedirectRules,
} from "@/lib/provider-model-redirects";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/models/test
 *
 * 模型测试：直接用渠道上游的 key 调用上游 API，不走本地 proxy。
 * 自动应用供应商的 modelRedirects 将本地模型名映射为上游模型名。
 *
 * Body: { model, messages, providerId }
 * Response: 透传上游 SSE 流
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { model, messages, providerId } = body as {
    model: string;
    messages: { role: string; content: string }[];
    providerId: number;
  };

  if (!model || !messages || !Array.isArray(messages) || !providerId) {
    return Response.json({ error: "缺少 model、messages 或 providerId 参数" }, { status: 400 });
  }

  // 获取供应商的 URL、key 和 modelRedirects
  const [provider] = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      providerType: providers.providerType,
      isEnabled: providers.isEnabled,
      modelRedirects: providers.modelRedirects,
    })
    .from(providers)
    .where(sql`${providers.id} = ${providerId} AND ${providers.deletedAt} IS NULL`)
    .limit(1);

  if (!provider) {
    return Response.json({ error: "供应商不存在" }, { status: 404 });
  }

  if (!provider.isEnabled) {
    return Response.json({ error: "该供应商已禁用" }, { status: 400 });
  }

  // 应用 modelRedirects：将本地模型名映射为上游实际模型名
  const normalizedRedirects = normalizeProviderModelRedirectRules(provider.modelRedirects);
  const upstreamModel =
    hasProviderModelRedirectRules(normalizedRedirects)
      ? getProviderModelRedirectTarget(model, normalizedRedirects)
      : model;

  if (upstreamModel !== model) {
    logger.info({
      action: "model_test_redirect",
      localModel: model,
      upstreamModel,
      providerId,
      providerName: provider.name,
    });
  }

  // 构建上游请求
  const providerUrl = provider.url.replace(/\/$/, "");
  const isAnthropic = provider.providerType === "claude" || provider.providerType === "claude-auth";

  let upstreamUrl: string;
  let headers: Record<string, string>;
  let requestBody: Record<string, unknown>;

  if (isAnthropic) {
    upstreamUrl = `${providerUrl}/v1/messages`;
    headers = {
      "Content-Type": "application/json",
      "x-api-key": provider.key,
      "anthropic-version": "2023-06-01",
    };
    requestBody = {
      model: upstreamModel,
      max_tokens: 4096,
      messages,
      stream: true,
    };
  } else {
    upstreamUrl = `${providerUrl}/v1/chat/completions`;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.key}`,
    };
    requestBody = {
      model: upstreamModel,
      messages,
      stream: true,
    };
  }

  logger.info({
    action: "model_test_direct",
    model,
    upstreamModel,
    providerId,
    providerName: provider.name,
    upstreamUrl,
  });

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorText = await upstreamResponse.text();
      let errorMessage = "请求失败";
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText.slice(0, 500) || errorMessage;
      }
      return Response.json({ error: { message: errorMessage } }, { status: upstreamResponse.status });
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("content-type") || "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ action: "model_test_direct_error", model, providerId, error: message });
    return Response.json({ error: { message: `连接上游失败: ${message}` } }, { status: 502 });
  }
}
