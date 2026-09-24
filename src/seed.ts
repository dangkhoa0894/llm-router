// Seeds a starter catalog: providers + models + deployments. Idempotent
// (upserts by slug), so re-running it updates prices in place.
//
//   npm run router:seed
//
// UPSTREAM COSTS BELOW ARE PLACEHOLDERS — check each provider's current
// pricing page before selling. Sell price = cheapest upstream cost * (1 +
// ROUTER_DEFAULT_MARKUP); adjust per model afterwards via the admin API.
import { config } from "./config";
import { prisma } from "./lib/prisma";
import { usdToMicros } from "./money";

interface SeedDeployment {
  provider: string;
  upstreamModel: string;
  priority: number;
  inputCost: number; // USD per 1M tokens
  outputCost: number;
}

interface SeedModel {
  slug: string;
  displayName: string;
  description: string;
  type?: "CHAT" | "EMBEDDING";
  contextLength: number;
  strategy?: "PRIORITY" | "LOWEST_COST" | "WEIGHTED";
  deployments: SeedDeployment[];
}

const providers = [
  { slug: "deepinfra", name: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai", apiKeyEnv: "DEEPINFRA_API_KEY" },
  { slug: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  { slug: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY" },
  { slug: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" },
  { slug: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY" },
];

const models: SeedModel[] = [
  {
    slug: "meta-llama/Llama-3.3-70B-Instruct",
    displayName: "Llama 3.3 70B Instruct",
    description: "Meta's 70B instruction-tuned model, strong multilingual chat.",
    contextLength: 131072,
    strategy: "LOWEST_COST",
    deployments: [
      { provider: "deepinfra", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", priority: 0, inputCost: 0.13, outputCost: 0.39 },
      { provider: "groq", upstreamModel: "llama-3.3-70b-versatile", priority: 1, inputCost: 0.59, outputCost: 0.79 },
      { provider: "together", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", priority: 2, inputCost: 0.88, outputCost: 0.88 },
    ],
  },
  {
    slug: "openai/gpt-oss-120b",
    displayName: "gpt-oss 120B",
    description: "OpenAI's open-weight 120B reasoning model.",
    contextLength: 131072,
    deployments: [
      { provider: "deepinfra", upstreamModel: "openai/gpt-oss-120b", priority: 0, inputCost: 0.09, outputCost: 0.45 },
      { provider: "groq", upstreamModel: "openai/gpt-oss-120b", priority: 1, inputCost: 0.15, outputCost: 0.75 },
    ],
  },
  {
    slug: "deepseek-ai/DeepSeek-V3",
    displayName: "DeepSeek V3",
    description: "DeepSeek's MoE flagship chat model.",
    contextLength: 131072,
    deployments: [
      { provider: "deepinfra", upstreamModel: "deepseek-ai/DeepSeek-V3", priority: 0, inputCost: 0.38, outputCost: 0.89 },
      { provider: "together", upstreamModel: "deepseek-ai/DeepSeek-V3", priority: 1, inputCost: 1.25, outputCost: 1.25 },
    ],
  },
  {
    slug: "Qwen/Qwen2.5-72B-Instruct",
    displayName: "Qwen 2.5 72B Instruct",
    description: "Alibaba's 72B model, good Vietnamese coverage.",
    contextLength: 32768,
    deployments: [{ provider: "deepinfra", upstreamModel: "Qwen/Qwen2.5-72B-Instruct", priority: 0, inputCost: 0.12, outputCost: 0.39 }],
  },
  {
    slug: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    description: "Google's fast multimodal model.",
    contextLength: 1048576,
    deployments: [
      { provider: "gemini", upstreamModel: "gemini-2.5-flash", priority: 0, inputCost: 0.3, outputCost: 2.5 },
      { provider: "deepinfra", upstreamModel: "google/gemini-2.5-flash", priority: 1, inputCost: 0.3, outputCost: 2.5 },
    ],
  },
  {
    slug: "openai/gpt-4o-mini",
    displayName: "GPT-4o mini",
    description: "OpenAI's small, fast, low-cost model.",
    contextLength: 128000,
    deployments: [{ provider: "openai", upstreamModel: "gpt-4o-mini", priority: 0, inputCost: 0.15, outputCost: 0.6 }],
  },
  {
    slug: "BAAI/bge-m3",
    displayName: "BGE-M3 (embeddings)",
    description: "Multilingual embedding model, 1024 dimensions.",
    type: "EMBEDDING",
    contextLength: 8192,
    deployments: [{ provider: "deepinfra", upstreamModel: "BAAI/bge-m3", priority: 0, inputCost: 0.01, outputCost: 0 }],
  },
];

// Sell at a markup over the cheapest upstream to stay price-competitive.
// Requests that fall back to a pricier deployment can then earn less or
// even lose money — watch marginUsd in GET /api/admin/usage.
function sellPrice(deployments: SeedDeployment[], pick: (d: SeedDeployment) => number): number {
  const minCost = Math.min(...deployments.map(pick));
  return Math.round(minCost * (1 + config.defaultMarkup) * 1000) / 1000;
}

async function main() {
  const providerIds = new Map<string, string>();
  for (const p of providers) {
    const row = await prisma.routerProvider.upsert({ where: { slug: p.slug }, create: p, update: { name: p.name, baseUrl: p.baseUrl, apiKeyEnv: p.apiKeyEnv } });
    providerIds.set(p.slug, row.id);
  }

  for (const m of models) {
    const prices = {
      inputPricePerMTokMicros: usdToMicros(sellPrice(m.deployments, (d) => d.inputCost)),
      outputPricePerMTokMicros: usdToMicros(sellPrice(m.deployments, (d) => d.outputCost)),
    };
    const fields = {
      displayName: m.displayName,
      description: m.description,
      contextLength: m.contextLength,
      strategy: m.strategy ?? "PRIORITY",
      ...prices,
    };
    const model = await prisma.routerModel.upsert({
      where: { slug: m.slug },
      create: { slug: m.slug, type: m.type ?? "CHAT", ...fields },
      update: fields,
    });

    for (const d of m.deployments) {
      const providerId = providerIds.get(d.provider)!;
      const values = {
        priority: d.priority,
        inputCostPerMTokMicros: usdToMicros(d.inputCost),
        outputCostPerMTokMicros: usdToMicros(d.outputCost),
      };
      await prisma.routerDeployment.upsert({
        where: { modelId_providerId_upstreamModel: { modelId: model.id, providerId, upstreamModel: d.upstreamModel } },
        create: { modelId: model.id, providerId, upstreamModel: d.upstreamModel, ...values },
        update: values,
      });
    }
    console.log(`seeded ${m.slug}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
