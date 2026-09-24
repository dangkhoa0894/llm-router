import type {
  CreditTransaction,
  RouterAccount,
  RouterApiKey,
  RouterDeployment,
  RouterModel,
  RouterProvider,
  RouterRequest,
} from "@prisma/client";
import { healthSnapshot } from "./health";
import { microsToUsd } from "./money";

// BigInt micros aren't JSON-serializable; every API response goes through
// one of these, which also converts money to plain USD numbers.

export const publicModel = (m: RouterModel) => ({
  id: m.slug,
  object: "model" as const,
  created: Math.floor(m.createdAt.getTime() / 1000),
  owned_by: m.slug.includes("/") ? m.slug.split("/")[0] : "router",
  type: m.type.toLowerCase(),
  display_name: m.displayName,
  description: m.description,
  context_length: m.contextLength,
  pricing: {
    currency: "USD",
    unit: "1M tokens",
    input: microsToUsd(m.inputPricePerMTokMicros),
    output: microsToUsd(m.outputPricePerMTokMicros),
  },
});

export const account = (a: RouterAccount) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  status: a.status,
  rpmLimit: a.rpmLimit,
  balanceUsd: microsToUsd(a.balanceMicros),
  createdAt: a.createdAt,
});

export const apiKey = (k: RouterApiKey) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  createdAt: k.createdAt,
});

export const transaction = (t: CreditTransaction) => ({
  id: t.id,
  type: t.type,
  amountUsd: microsToUsd(t.amountMicros),
  balanceAfterUsd: microsToUsd(t.balanceAfterMicros),
  requestId: t.requestId,
  reference: t.reference,
  note: t.note,
  createdAt: t.createdAt,
});

export const request = (r: RouterRequest, opts: { internal?: boolean } = {}) => ({
  id: r.id,
  model: r.modelSlug,
  endpoint: r.endpoint,
  stream: r.stream,
  status: r.status,
  httpStatus: r.httpStatus,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  usageEstimated: r.usageEstimated,
  chargeUsd: microsToUsd(r.chargeMicros),
  latencyMs: r.latencyMs,
  createdAt: r.createdAt,
  // Upstream details (who served it, what it cost us, raw errors) stay internal.
  ...(opts.internal
    ? { accountId: r.accountId, deploymentId: r.deploymentId, costUsd: microsToUsd(r.costMicros), attempts: r.attempts, errorMessage: r.errorMessage }
    : {}),
});

export const provider = (p: RouterProvider) => ({
  ...p,
  apiKeyConfigured: Boolean(process.env[p.apiKeyEnv]),
});

export const deployment = (d: RouterDeployment & { provider?: RouterProvider }) => ({
  id: d.id,
  modelId: d.modelId,
  providerId: d.providerId,
  provider: d.provider ? provider(d.provider) : undefined,
  upstreamModel: d.upstreamModel,
  priority: d.priority,
  weight: d.weight,
  inputCostUsdPerMTok: microsToUsd(d.inputCostPerMTokMicros),
  outputCostUsdPerMTok: microsToUsd(d.outputCostPerMTokMicros),
  isEnabled: d.isEnabled,
  health: healthSnapshot(d.id),
});

export const adminModel = (m: RouterModel & { deployments?: (RouterDeployment & { provider?: RouterProvider })[] }) => ({
  id: m.id,
  slug: m.slug,
  displayName: m.displayName,
  description: m.description,
  type: m.type,
  contextLength: m.contextLength,
  inputPriceUsdPerMTok: microsToUsd(m.inputPricePerMTokMicros),
  outputPriceUsdPerMTok: microsToUsd(m.outputPricePerMTokMicros),
  strategy: m.strategy,
  isPublic: m.isPublic,
  isEnabled: m.isEnabled,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
  deployments: m.deployments?.map(deployment),
});
