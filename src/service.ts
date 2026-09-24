import { Prisma } from "@prisma/client";
import { conflict, notFound } from "./lib/httpError";
import { prisma } from "./lib/prisma";
import { adjustCredit } from "./billing";
import { generateApiKey } from "./keys";
import { microsToUsd, usdToMicros } from "./money";
import * as serialize from "./serialize";

function rethrowUnique(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict(message);
  throw err;
}

// ---- accounts & keys -----------------------------------------------------

export async function createAccount(input: { name: string; email: string; rpmLimit?: number; initialCreditUsd?: number }) {
  const account = await prisma.routerAccount
    .create({ data: { name: input.name, email: input.email.toLowerCase(), rpmLimit: input.rpmLimit } })
    .catch((err) => rethrowUnique(err, `An account with email ${input.email} already exists`));
  if (input.initialCreditUsd && input.initialCreditUsd > 0) {
    await adjustCredit({ accountId: account.id, type: "TOPUP", amountMicros: usdToMicros(input.initialCreditUsd), note: "Initial credit" });
  }
  const key = await createApiKey(account.id, "default");
  const fresh = await prisma.routerAccount.findUniqueOrThrow({ where: { id: account.id } });
  return { account: serialize.account(fresh), apiKey: key };
}

// The plaintext key is only ever returned here.
export async function createApiKey(accountId: string, name: string) {
  const { plaintext, prefix, keyHash } = generateApiKey();
  const key = await prisma.routerApiKey.create({ data: { accountId, name, prefix, keyHash } });
  return { ...serialize.apiKey(key), key: plaintext };
}

export async function listApiKeys(accountId: string) {
  const keys = await prisma.routerApiKey.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
  return keys.map(serialize.apiKey);
}

export async function revokeApiKey(keyId: string, accountId?: string) {
  const key = await prisma.routerApiKey.findFirst({ where: { id: keyId, ...(accountId ? { accountId } : {}) } });
  if (!key) throw notFound("API key");
  const updated = await prisma.routerApiKey.update({ where: { id: key.id }, data: { revokedAt: key.revokedAt ?? new Date() } });
  return serialize.apiKey(updated);
}

export async function getAccountOrThrow(accountId: string) {
  const account = await prisma.routerAccount.findUnique({ where: { id: accountId } });
  if (!account) throw notFound("Account");
  return account;
}

export async function listTransactions(accountId: string, limit: number) {
  const rows = await prisma.creditTransaction.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(serialize.transaction);
}

export async function listRequests(where: Prisma.RouterRequestWhereInput, limit: number, internal = false) {
  const rows = await prisma.routerRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => serialize.request(r, { internal }));
}

interface UsageRow {
  day: Date;
  model: string;
  requests: bigint;
  errors: bigint;
  input_tokens: bigint;
  output_tokens: bigint;
  charge_micros: bigint;
  cost_micros: bigint;
}

// Daily usage per model. `accountId` omitted = platform-wide (admin), which
// also exposes cost and margin.
export async function usageByDay(days: number, accountId?: string) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT date_trunc('day', "createdAt") AS day,
           "modelSlug" AS model,
           COUNT(*) AS requests,
           COUNT(*) FILTER (WHERE status = 'ERROR') AS errors,
           COALESCE(SUM("inputTokens"), 0) AS input_tokens,
           COALESCE(SUM("outputTokens"), 0) AS output_tokens,
           COALESCE(SUM("chargeMicros"), 0) AS charge_micros,
           COALESCE(SUM("costMicros"), 0) AS cost_micros
    FROM "RouterRequest"
    WHERE "createdAt" >= ${since}
      ${accountId ? Prisma.sql`AND "accountId" = ${accountId}` : Prisma.empty}
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2`;

  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    model: r.model,
    requests: Number(r.requests),
    errors: Number(r.errors),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    chargeUsd: microsToUsd(BigInt(r.charge_micros)),
    ...(accountId
      ? {}
      : {
          costUsd: microsToUsd(BigInt(r.cost_micros)),
          marginUsd: microsToUsd(BigInt(r.charge_micros) - BigInt(r.cost_micros)),
        }),
  }));
}

// ---- catalog (admin) -----------------------------------------------------

export async function listPublicModels() {
  const models = await prisma.routerModel.findMany({ where: { isPublic: true, isEnabled: true }, orderBy: { slug: "asc" } });
  return models.map(serialize.publicModel);
}

export async function listProviders() {
  const providers = await prisma.routerProvider.findMany({ orderBy: { slug: "asc" } });
  return providers.map(serialize.provider);
}

export async function createProvider(data: Prisma.RouterProviderCreateInput) {
  const provider = await prisma.routerProvider
    .create({ data })
    .catch((err) => rethrowUnique(err, `Provider "${data.slug}" already exists`));
  return serialize.provider(provider);
}

export async function updateProvider(id: string, data: Prisma.RouterProviderUpdateInput) {
  await prisma.routerProvider.findUniqueOrThrow({ where: { id } }).catch(() => {
    throw notFound("Provider");
  });
  return serialize.provider(await prisma.routerProvider.update({ where: { id }, data }));
}

interface ModelInput {
  displayName?: string;
  description?: string | null;
  contextLength?: number | null;
  inputPriceUsdPerMTok?: number;
  outputPriceUsdPerMTok?: number;
  strategy?: "PRIORITY" | "LOWEST_COST" | "WEIGHTED";
  isPublic?: boolean;
  isEnabled?: boolean;
}

function modelData({ inputPriceUsdPerMTok, outputPriceUsdPerMTok, ...rest }: ModelInput) {
  return {
    ...rest,
    ...(inputPriceUsdPerMTok !== undefined ? { inputPricePerMTokMicros: usdToMicros(inputPriceUsdPerMTok) } : {}),
    ...(outputPriceUsdPerMTok !== undefined ? { outputPricePerMTokMicros: usdToMicros(outputPriceUsdPerMTok) } : {}),
  };
}

const modelInclude = { deployments: { include: { provider: true }, orderBy: { priority: "asc" as const } } };

export async function listModels() {
  const models = await prisma.routerModel.findMany({ include: modelInclude, orderBy: { slug: "asc" } });
  return models.map(serialize.adminModel);
}

export async function getModel(id: string) {
  const model = await prisma.routerModel.findUnique({ where: { id }, include: modelInclude });
  if (!model) throw notFound("Model");
  return serialize.adminModel(model);
}

export async function createModel(input: ModelInput & { slug: string; displayName: string; type: "CHAT" | "EMBEDDING"; inputPriceUsdPerMTok: number }) {
  const { slug, type, ...rest } = input;
  const model = await prisma.routerModel
    .create({
      data: { slug, type, displayName: input.displayName, inputPricePerMTokMicros: 0n, ...modelData(rest) },
      include: modelInclude,
    })
    .catch((err) => rethrowUnique(err, `Model "${slug}" already exists`));
  return serialize.adminModel(model);
}

export async function updateModel(id: string, input: ModelInput) {
  await getModel(id);
  return serialize.adminModel(await prisma.routerModel.update({ where: { id }, data: modelData(input), include: modelInclude }));
}

interface DeploymentInput {
  upstreamModel?: string;
  priority?: number;
  weight?: number;
  inputCostUsdPerMTok?: number;
  outputCostUsdPerMTok?: number;
  isEnabled?: boolean;
}

function deploymentData({ inputCostUsdPerMTok, outputCostUsdPerMTok, ...rest }: DeploymentInput) {
  return {
    ...rest,
    ...(inputCostUsdPerMTok !== undefined ? { inputCostPerMTokMicros: usdToMicros(inputCostUsdPerMTok) } : {}),
    ...(outputCostUsdPerMTok !== undefined ? { outputCostPerMTokMicros: usdToMicros(outputCostUsdPerMTok) } : {}),
  };
}

export async function createDeployment(modelId: string, input: DeploymentInput & { providerId: string; upstreamModel: string }) {
  await getModel(modelId);
  const provider = await prisma.routerProvider.findUnique({ where: { id: input.providerId } });
  if (!provider) throw notFound("Provider");
  const { providerId, upstreamModel, ...rest } = input;
  const deployment = await prisma.routerDeployment
    .create({ data: { modelId, providerId, upstreamModel, ...deploymentData(rest) }, include: { provider: true } })
    .catch((err) => rethrowUnique(err, "This model already has a deployment for that provider/upstream model"));
  return serialize.deployment(deployment);
}

export async function updateDeployment(id: string, input: DeploymentInput) {
  const existing = await prisma.routerDeployment.findUnique({ where: { id } });
  if (!existing) throw notFound("Deployment");
  const deployment = await prisma.routerDeployment.update({ where: { id }, data: deploymentData(input), include: { provider: true } });
  return serialize.deployment(deployment);
}

export async function deleteDeployment(id: string) {
  const existing = await prisma.routerDeployment.findUnique({ where: { id } });
  if (!existing) throw notFound("Deployment");
  await prisma.routerDeployment.delete({ where: { id } });
}

export async function listAccounts() {
  const accounts = await prisma.routerAccount.findMany({ orderBy: { createdAt: "desc" } });
  return accounts.map(serialize.account);
}
