import type { RouterDeployment, RouterModel, RouterProvider, RouterRoutingStrategy } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { isOpen } from "./health";

export type Candidate = RouterDeployment & { provider: RouterProvider; apiKey: string };
export type RoutableModel = RouterModel & { candidates: Candidate[] };

export async function loadRoutableModel(slug: string): Promise<RoutableModel | null> {
  const model = await prisma.routerModel.findUnique({
    where: { slug },
    include: { deployments: { where: { isEnabled: true, provider: { isEnabled: true } }, include: { provider: true } } },
  });
  if (!model || !model.isEnabled) return null;

  // Deployments whose provider key isn't configured in this environment are
  // silently skipped, so a catalog can list providers you haven't signed up for yet.
  const candidates: Candidate[] = [];
  for (const deployment of model.deployments) {
    const apiKey = process.env[deployment.provider.apiKeyEnv];
    if (apiKey) candidates.push({ ...deployment, apiKey });
  }
  const { deployments: _deployments, ...rest } = model;
  return { ...rest, candidates };
}

export function orderCandidates<T extends RouterDeployment>(
  strategy: RouterRoutingStrategy,
  candidates: T[],
  random: () => number = Math.random,
  now = Date.now(),
): T[] {
  let ordered: T[];
  switch (strategy) {
    case "LOWEST_COST":
      ordered = [...candidates].sort((a, b) => {
        const costA = a.inputCostPerMTokMicros + a.outputCostPerMTokMicros;
        const costB = b.inputCostPerMTokMicros + b.outputCostPerMTokMicros;
        return costA === costB ? a.priority - b.priority : costA < costB ? -1 : 1;
      });
      break;
    case "WEIGHTED":
      ordered = weightedShuffle(candidates, random);
      break;
    default:
      ordered = [...candidates].sort((a, b) => a.priority - b.priority);
  }

  // Tripped circuits go last rather than being dropped: if everything is
  // down, trying anyway beats failing without an attempt.
  const healthy = ordered.filter((c) => !isOpen(c.id, now));
  const tripped = ordered.filter((c) => isOpen(c.id, now));
  return [...healthy, ...tripped];
}

function weightedShuffle<T extends RouterDeployment>(items: T[], random: () => number): T[] {
  const pool = [...items];
  const result: T[] = [];
  while (pool.length > 0) {
    const total = pool.reduce((sum, c) => sum + Math.max(c.weight, 0), 0);
    let index = 0;
    if (total > 0) {
      let pick = random() * total;
      index = pool.findIndex((c) => (pick -= Math.max(c.weight, 0)) < 0);
      if (index < 0) index = pool.length - 1;
    }
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}
