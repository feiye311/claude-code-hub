import { z } from "@hono/zod-openapi";

export const ProviderIdParamSchema = z.object({
  providerId: z.coerce.number().int().positive().describe("Provider id."),
});

export const ProviderKeyIdParamSchema = z.object({
  providerId: z.coerce.number().int().positive().describe("Provider id."),
  keyId: z.coerce.number().int().positive().describe("Provider key id."),
});

export const ProviderKeyCreateSchema = z
  .object({
    key: z.string().trim().min(1).max(2048).describe("API key."),
    name: z.string().trim().max(200).nullable().optional().describe("Key name."),
    weight: z.number().int().min(1).default(1).describe("Key weight."),
    isEnabled: z.boolean().optional().describe("Whether the key is enabled."),
  })
  .strict();

export const ProviderKeyUpdateSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional().describe("Key name."),
    weight: z.number().int().min(1).optional().describe("Key weight."),
    isEnabled: z.boolean().optional().describe("Whether the key is enabled."),
  })
  .strict();

export const ProviderKeyCircuitSchema = z.object({
  state: z.enum(["closed", "open", "half-open"]).describe("Circuit breaker state."),
  failures: z.number().int().min(0).describe("Failure count."),
  until: z.number().int().positive().nullable().optional().describe("Circuit open until timestamp."),
});

export const ProviderKeyResponseSchema = z.object({
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  key: z.string(),
  name: z.string().nullable(),
  weight: z.number().int().min(1),
  isEnabled: z.boolean(),
  circuit: ProviderKeyCircuitSchema,
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const ProviderKeyCreateResponseSchema = z.object({
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  key: z.string(),
  name: z.string().nullable(),
  weight: z.number().int().min(1),
  isEnabled: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const ProviderKeyListResponseSchema = z.object({
  items: z.array(ProviderKeyResponseSchema),
});

export const ProviderKeyGenericResponseSchema = z.object({
  success: z.boolean(),
});