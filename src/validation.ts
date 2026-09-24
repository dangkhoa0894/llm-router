import { z } from "zod";

const slug = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/, "letters, digits and . _ : / - only");
const usdPerMTok = z.number().min(0).max(10_000);

export const createProviderSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  baseUrl: z.string().url().transform((u) => u.replace(/\/+$/, "")),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "must be an env var name, e.g. DEEPINFRA_API_KEY"),
  isEnabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
});
export const updateProviderSchema = createProviderSchema.omit({ slug: true }).partial();

export const createModelSchema = z.object({
  slug,
  displayName: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["CHAT", "EMBEDDING"]).default("CHAT"),
  contextLength: z.number().int().positive().optional(),
  inputPriceUsdPerMTok: usdPerMTok,
  outputPriceUsdPerMTok: usdPerMTok.default(0),
  strategy: z.enum(["PRIORITY", "LOWEST_COST", "WEIGHTED"]).default("PRIORITY"),
  isPublic: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});
export const updateModelSchema = createModelSchema
  .omit({ slug: true, type: true })
  .partial()
  .extend({ description: z.string().nullable().optional(), contextLength: z.number().int().positive().nullable().optional() });

export const createDeploymentSchema = z.object({
  providerId: z.string().min(1),
  upstreamModel: z.string().min(1),
  priority: z.number().int().default(0),
  weight: z.number().int().min(0).default(1),
  inputCostUsdPerMTok: usdPerMTok.default(0),
  outputCostUsdPerMTok: usdPerMTok.default(0),
  isEnabled: z.boolean().optional(),
});
export const updateDeploymentSchema = createDeploymentSchema.omit({ providerId: true }).partial();

export const createAccountSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  rpmLimit: z.number().int().min(1).max(100_000).optional(),
  initialCreditUsd: z.number().min(0).optional(),
});
export const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  rpmLimit: z.number().int().min(1).max(100_000).optional(),
});

export const creditSchema = z
  .object({
    type: z.enum(["TOPUP", "REFUND", "ADJUSTMENT"]).default("TOPUP"),
    amountUsd: z.number().refine((v) => v !== 0, "must be non-zero"),
    reference: z.string().min(1).max(200).optional(),
    note: z.string().max(1000).optional(),
  })
  .refine((v) => v.type === "ADJUSTMENT" || v.amountUsd > 0, "only ADJUSTMENT may be negative");

export const createKeySchema = z.object({ name: z.string().min(1).max(100).default("default") });

export const signupSchema = z.object({ name: z.string().min(1), email: z.string().email() });

export const daysQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
export const limitQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });

export const createTopupSchema = z.object({ amountVnd: z.number().int().positive() });
export const assignBankTransactionSchema = z.object({ accountId: z.string().min(1) });
export const bankTransactionQuerySchema = z.object({
  status: z.enum(["MATCHED", "UNMATCHED", "IGNORED"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
