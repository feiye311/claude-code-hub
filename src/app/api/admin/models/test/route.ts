import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { buildProxyUrl } from "@/app/v1/_lib/url";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  getProviderModelRedirectTarget,
  hasProviderModelRedirectRules,
  normalizeProviderModelRedirectRules,
} from "@/lib/provider-model-redirects";
import { resolveAnthropicAuthHeaders } from "@/app/v1/_lib/headers";
import type { ProviderType } from "@/types/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/models/test
 *
 * 模型测试：直接用渠道上游的 key 调用上游 API，不走本地 proxy。
 * 自动应用供应商的 modelRedirects 将本地模型名映射为上游模型名。
 * URL 构建与供应商设置页面的测试连接完全一致（使用 buildProxyUrl）。
 *
 * Body: { model, messages, providerId }
 * Response: 透传上游 SSE 流
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.user.role !== "admin") {
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

  // 获取供应商信息
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
  const upstreamModel = hasProviderModelRedirectRules(normalizedRedirects)
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

  const providerType = provider.providerType as ProviderType;
  const isAnthropic = providerType === "claude" || providerType === "claude-auth";
  const providerUrl = provider.url;

  // 构建请求配置: 按 Anthropic / OpenAI 两种格式
  function buildRequest(format: "anthropic" | "openai") {
    const requestPath = format === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
    // 使用 buildProxyUrl 与 proxy 转发和供应商测试保持一致的 URL 拼接逻辑
    const requestUrl = new URL(`https://model-test.local${requestPath}`);
    const finalUrl = buildProxyUrl(providerUrl, requestUrl);

    if (format === "anthropic") {
      const outboundKey = Array.isArray(provider.key) ? provider.key[0] ?? "" : provider.key;
      const authHeaders = resolveAnthropicAuthHeaders(outboundKey, providerUrl, {
        forceBearerOnly: providerType === "claude-auth",
      });
      return {
        url: finalUrl,
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          ...authHeaders,
        } as Record<string, string>,
        body: {
          model: upstreamModel,
          max_tokens: 4096,
          messages,
          stream: true,
        } as Record<string, unknown>,
      };
    }
    return {
      url: finalUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      } as Record<string, string>,
      body: {
        model: upstreamModel,
        messages,
        stream: true,
      } as Record<string, unknown>,
    };
  }

  // 按供应商类型决定首选格式
  const primaryFormat: "anthropic" | "openai" = isAnthropic ? "anthropic" : "openai";
  const fallbackFormat: "anthropic" | "openai" =
    primaryFormat === "anthropic" ? "openai" : "anthropic";

  logger.info({
    action: "model_test_direct",
    model,
    upstreamModel,
    providerId,
    providerName: provider.name,
    providerType,
    primaryFormat,
  });

  try {
    const primary = buildRequest(primaryFormat);

    let upstreamResponse = await fetch(primary.url, {
      method: "POST",
      headers: primary.headers,
      body: JSON.stringify(primary.body),
      signal: request.signal,
    });

    // 首选格式返回 404 时,自动尝试另一种格式
    if (upstreamResponse.status === 404 && primaryFormat !== fallbackFormat) {
      const fallback = buildRequest(fallbackFormat);
      logger.info({
        action: "model_test_fallback",
        model,
        providerId,
        primaryUrl: primary.url,
        fallbackUrl: fallback.url,
      });
      upstreamResponse = await fetch(fallback.url, {
        method: "POST",
        headers: fallback.headers,
        body: JSON.stringify(fallback.body),
        signal: request.signal,
      });
    }

    const finalUpstreamUrl = upstreamResponse.url;

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorText = await upstreamResponse.text();
      const upstreamStatus = upstreamResponse.status;

      logger.warn({
        action: "model_test_upstream_error",
        model,
        upstreamModel,
        providerId,
        providerName: provider.name,
        upstreamUrl: finalUpstreamUrl,
        upstreamStatus,
        upstreamBody: errorText.slice(0, 500),
      });

      let errorMessage = `上游返回错误 (HTTP ${upstreamStatus})`;
      if (errorText) {
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage =
            errorJson.error?.message || errorJson.message || errorJson.error || errorMessage;
        } catch {
          errorMessage = errorText.slice(0, 500) || errorMessage;
        }
      }

      return Response.json({ error: { message: errorMessage } }, { status: upstreamStatus });
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
