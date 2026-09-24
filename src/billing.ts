import type { CreditTransactionType, RouterRequestStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { conflict, notFound } from "./lib/httpError";

export interface RequestRecord {
  accountId: string;
  apiKeyId: string;
  modelId?: string;
  deploymentId?: string;
  modelSlug: string;
  endpoint: string;
  stream: boolean;
  status: RouterRequestStatus;
  httpStatus: number;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  usageEstimated?: boolean;
  costMicros?: bigint;
  chargeMicros?: bigint;
  attempts: number;
  latencyMs: number;
}

// Logs the request and debits its charge in one transaction. The balance
// may go slightly negative on the request that exhausts it (the size of a
// response isn't known up front); the next request is then refused with 402.
export async function recordRequest(record: RequestRecord) {
  const charge = record.chargeMicros ?? 0n;
  return prisma.$transaction(async (tx) => {
    const request = await tx.routerRequest.create({ data: record });
    if (charge > 0n) {
      const account = await tx.routerAccount.update({
        where: { id: record.accountId },
        data: { balanceMicros: { decrement: charge } },
      });
      await tx.creditTransaction.create({
        data: {
          accountId: record.accountId,
          type: "USAGE",
          amountMicros: -charge,
          balanceAfterMicros: account.balanceMicros,
          requestId: request.id,
        },
      });
    }
    return request;
  });
}

export interface CreditAdjustment {
  accountId: string;
  type: Exclude<CreditTransactionType, "USAGE">;
  amountMicros: bigint;
  reference?: string;
  note?: string;
}

// `reference` (e.g. a payment gateway transaction id) makes top-ups
// idempotent: replaying the same reference is rejected with 409.
export async function adjustCredit(input: CreditAdjustment) {
  try {
    return await prisma.$transaction(async (tx) => {
      const exists = await tx.routerAccount.findUnique({ where: { id: input.accountId }, select: { id: true } });
      if (!exists) throw notFound("Account");
      const account = await tx.routerAccount.update({
        where: { id: input.accountId },
        data: { balanceMicros: { increment: input.amountMicros } },
      });
      return tx.creditTransaction.create({
        data: {
          accountId: input.accountId,
          type: input.type,
          amountMicros: input.amountMicros,
          balanceAfterMicros: account.balanceMicros,
          reference: input.reference,
          note: input.note,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict(`A credit transaction with reference "${input.reference}" already exists`);
    }
    throw err;
  }
}
