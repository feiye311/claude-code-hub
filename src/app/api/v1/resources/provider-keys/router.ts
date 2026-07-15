import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createProblemResponse, fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderIdParamSchema,
  ProviderKeyIdParamSchema,
  ProviderKeyCreateSchema,
  ProviderKeyUpdateSchema,
  ProviderKeyListResponseSchema,
  ProviderKeyCreateResponseSchema,
  ProviderKeyGenericResponseSchema,
} from "@/lib/api/v1/schemas/provider-keys";
import { getKeyCircuitInfo, resetKeyCircuit } from "@/lib/api-key-circuit";
import {
  listProviderKeys,
  createProviderKey,
  updateProviderKey,
  deleteProviderKey,
  getProviderKeyById,
} from "@/repository/provider-keys";
import { findProviderById } from "@/repository/provider";

const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const problemResponses = {
  400: { description: "Invalid request.", content: { "application/problem+json": { schema: ProblemJsonSchema } } },
  401: { description: "Authentication required.", content: { "application/problem+json": { schema: ProblemJsonSchema } } },
  403: { description: "Admin access required.", content: { "application/problem+json": { schema: ProblemJsonSchema } } },
  404: { description: "Not found.", content: { "application/problem+json": { schema: ProblemJsonSchema } } },
} as const;

export const providerKeysRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return fromZodError(result.error, new URL(c.req.url).pathname);
    }
  },
});

function notFound(c: any, detail: string) {
  return c.json(createProblemResponse({ status: 404, detail }), 404);
}

// GET /providers/{providerId}/keys
providerKeysRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/{providerId}/keys",
    middleware: requireAuth("admin"),
    tags: ["Provider Keys"],
    summary: "List provider keys",
    description: "Lists all keys for a provider with circuit breaker state.",
    security,
    request: { params: ProviderIdParamSchema },
    responses: {
      200: { description: "Provider key list.", content: { "application/json": { schema: ProviderKeyListResponseSchema } } },
      ...problemResponses,
    },
  }),
  async (c) => {
    const { providerId } = c.req.valid("param");
    const provider = await findProviderById(providerId);
    if (!provider) return notFound(c, "Provider not found");

    const keys = await listProviderKeys(providerId);
    const items = keys.map((k) => ({
      id: k.id,
      providerId: k.providerId,
      key: k.key,
      name: k.name,
      weight: k.weight,
      isEnabled: k.isEnabled,
      circuit: getKeyCircuitInfo(k.key),
      createdAt: k.createdAt?.toISOString() ?? null,
      updatedAt: k.updatedAt?.toISOString() ?? null,
    }));

    return c.json({ items }, 200);
  }
);

// POST /providers/{providerId}/keys
providerKeysRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/{providerId}/keys",
    middleware: requireAuth("admin"),
    tags: ["Provider Keys"],
    summary: "Create provider key",
    description: "Creates a new API key for a provider.",
    security,
    request: {
      params: ProviderIdParamSchema,
      body: { required: true, content: { "application/json": { schema: ProviderKeyCreateSchema } } },
    },
    responses: {
      201: { description: "Created provider key.", content: { "application/json": { schema: ProviderKeyCreateResponseSchema } } },
      ...problemResponses,
    },
  }),
  async (c) => {
    const { providerId } = c.req.valid("param");
    const body = c.req.valid("json");

    const provider = await findProviderById(providerId);
    if (!provider) return notFound(c, "Provider not found");

    const key = await createProviderKey({
      providerId,
      key: body.key,
      name: body.name ?? null,
      weight: body.weight ?? 1,
      isEnabled: body.isEnabled ?? true,
    });

    return c.json(
      {
        id: key.id,
        providerId: key.providerId,
        key: key.key,
        name: key.name,
        weight: key.weight,
        isEnabled: key.isEnabled,
        createdAt: key.createdAt?.toISOString() ?? null,
        updatedAt: key.updatedAt?.toISOString() ?? null,
      },
      201
    );
  }
);

// PATCH /providers/{providerId}/keys/{keyId}
providerKeysRouter.openapi(
  createRoute({
    method: "patch",
    path: "/providers/{providerId}/keys/{keyId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Keys"],
    summary: "Update provider key",
    description: "Updates a provider key (name, weight, isEnabled).",
    security,
    request: {
      params: ProviderKeyIdParamSchema,
      body: { required: true, content: { "application/json": { schema: ProviderKeyUpdateSchema } } },
    },
    responses: {
      200: { description: "Updated provider key.", content: { "application/json": { schema: ProviderKeyCreateResponseSchema } } },
      ...problemResponses,
    },
  }),
  async (c) => {
    const { providerId, keyId } = c.req.valid("param");
    const body = c.req.valid("json");

    const provider = await findProviderById(providerId);
    if (!provider) return notFound(c, "Provider not found");

    const updated = await updateProviderKey(keyId, body);
    if (!updated) return notFound(c, "Provider key not found");

    return c.json(
      {
        id: updated.id,
        providerId: updated.providerId,
        key: updated.key,
        name: updated.name,
        weight: updated.weight,
        isEnabled: updated.isEnabled,
        createdAt: updated.createdAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
      200
    );
  }
);

// DELETE /providers/{providerId}/keys/{keyId}
providerKeysRouter.openapi(
  createRoute({
    method: "delete",
    path: "/providers/{providerId}/keys/{keyId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Keys"],
    summary: "Delete provider key",
    description: "Deletes a provider key.",
    security,
    request: { params: ProviderKeyIdParamSchema },
    responses: {
      204: { description: "Deleted." },
      ...problemResponses,
    },
  }),
  async (c) => {
    const { providerId, keyId } = c.req.valid("param");

    const provider = await findProviderById(providerId);
    if (!provider) return notFound(c, "Provider not found");

    const deleted = await deleteProviderKey(keyId);
    if (!deleted) return notFound(c, "Provider key not found");

    return c.body(null, 204);
  }
);

// POST /providers/{providerId}/keys/{keyId}/reset-circuit
providerKeysRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/{providerId}/keys/{keyId}/reset-circuit",
    middleware: requireAuth("admin"),
    tags: ["Provider Keys"],
    summary: "Reset key circuit",
    description: "Manually resets the circuit breaker for a provider key.",
    security,
    request: { params: ProviderKeyIdParamSchema },
    responses: {
      200: { description: "Circuit reset.", content: { "application/json": { schema: ProviderKeyGenericResponseSchema } } },
      ...problemResponses,
    },
  }),
  async (c) => {
    const { providerId, keyId } = c.req.valid("param");

    const provider = await findProviderById(providerId);
    if (!provider) return notFound(c, "Provider not found");

    const key = await getProviderKeyById(keyId);
    if (!key) return notFound(c, "Provider key not found");

    resetKeyCircuit(key.key);
    return c.json({ success: true }, 200);
  }
);