import { randomInt } from "node:crypto";
import type { TopupOrder } from "@prisma/client";
import { Prisma } from "@prisma/client";
import QRCode from "qrcode";
import { config } from "../config";
import { badRequest, conflict, HttpError, notFound } from "../lib/httpError";
import { prisma } from "../lib/prisma";
import { creditInTransaction } from "../billing";
import { microsToUsd } from "../money";
import type { NormalizedBankTransaction } from "./sepay";
import { buildVietQrPayload } from "./vietqr";

// No 0/O/1/I, so a code read off a screen or retyped into a memo survives.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateOrderCode(prefix = config.vietqr.codePrefix): string {
  let code = prefix;
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// Finds an order code in a bank memo. Banks upper-case, truncate, or glue
// the memo to other text ("MBVCB.123.LLMR7K2Q9XTA.CT tu ..."), and some
// insert spaces, so we also retry with every non-alphanumeric removed.
export function extractOrderCodes(content: string, prefix = config.vietqr.codePrefix): string[] {
  const pattern = new RegExp(`${prefix}[${CODE_ALPHABET}]{${CODE_LENGTH}}`, "g");
  const upper = content.toUpperCase();
  const found = new Set([...upper.matchAll(pattern)].map((m) => m[0]));
  for (const m of upper.replace(/[^A-Z0-9]/g, "").matchAll(pattern)) found.add(m[0]);
  return [...found];
}

export function vndToMicros(amountVnd: number, vndPerUsd: number): bigint {
  return (BigInt(amountVnd) * 1_000_000n) / BigInt(vndPerUsd);
}

function requireVietQrConfigured() {
  const { bankBin, accountNo } = config.vietqr;
  if (!bankBin || !accountNo) throw new HttpError(503, "VietQR top-ups are not configured: set VIETQR_BANK_BIN and VIETQR_ACCOUNT_NO");
  return { bankBin, accountNo };
}

// PENDING orders past their deadline read as EXPIRED. A late payment is
// still credited (the money did arrive) — expiry only stops showing the QR.
function effectiveStatus(order: TopupOrder, now = new Date()) {
  return order.status === "PENDING" && order.expiresAt <= now ? "EXPIRED" : order.status;
}

async function serializeOrder(order: TopupOrder, { withPayment = true } = {}) {
  const status = effectiveStatus(order);
  const base = {
    id: order.id,
    code: order.code,
    status,
    amountVnd: order.amountVnd,
    vndPerUsd: order.vndPerUsd,
    creditUsdEstimate: microsToUsd(vndToMicros(order.amountVnd, order.vndPerUsd)),
    paidAmountVnd: order.paidAmountVnd,
    creditedUsd: microsToUsd(order.creditMicros),
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
  };
  if (status !== "PENDING" || !withPayment) return base;

  const { bankBin, accountNo } = requireVietQrConfigured();
  const qrPayload = buildVietQrPayload({ bankBin, accountNo, amountVnd: order.amountVnd, memo: order.code });
  return {
    ...base,
    payment: {
      bankBin,
      bankName: config.vietqr.bankName,
      accountNo,
      accountName: config.vietqr.accountName,
      amountVnd: order.amountVnd,
      memo: order.code,
      qrPayload,
      qrImage: await QRCode.toDataURL(qrPayload, { margin: 1, width: 320 }),
    },
  };
}

export async function createTopupOrder(accountId: string, amountVnd: number) {
  requireVietQrConfigured();
  const { minVnd, maxVnd, vndPerUsd, orderTtlMinutes } = config.vietqr;
  if (amountVnd < minVnd || amountVnd > maxVnd) {
    throw badRequest(`Top-up amount must be between ${minVnd} and ${maxVnd} VND`);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const order = await prisma.topupOrder.create({
        data: {
          accountId,
          code: generateOrderCode(),
          amountVnd,
          vndPerUsd,
          expiresAt: new Date(Date.now() + orderTtlMinutes * 60_000),
        },
      });
      return serializeOrder(order);
    } catch (err) {
      // Code collision (32^8 space, so vanishingly rare): draw another.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw conflict("Could not allocate a unique top-up code, please retry");
}

export async function getTopupOrder(orderId: string, accountId?: string) {
  const order = await prisma.topupOrder.findFirst({ where: { id: orderId, ...(accountId ? { accountId } : {}) } });
  if (!order) throw notFound("Top-up order");
  return serializeOrder(order);
}

export async function listTopupOrders(where: Prisma.TopupOrderWhereInput, limit: number) {
  const orders = await prisma.topupOrder.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  // The list view skips QR images to stay light; fetch one order for those.
  return Promise.all(orders.map((o) => serializeOrder(o, { withPayment: false })));
}

export async function cancelTopupOrder(orderId: string, accountId: string) {
  const order = await prisma.topupOrder.findFirst({ where: { id: orderId, accountId } });
  if (!order) throw notFound("Top-up order");
  if (order.status !== "PENDING") throw conflict(`Order is already ${order.status.toLowerCase()}`);
  return serializeOrder(await prisma.topupOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } }));
}

// ---- incoming bank transactions -------------------------------------------

export type ApplyResult =
  | { outcome: "duplicate"; bankTransactionId: string }
  | { outcome: "ignored" | "unmatched"; bankTransactionId: string }
  | { outcome: "credited"; bankTransactionId: string; orderId: string; accountId: string; creditedUsd: number };

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// Idempotent on (provider, externalId): webhook retries of the same bank
// transaction are recorded — and credited — exactly once.
export async function applyBankTransaction(txn: NormalizedBankTransaction): Promise<ApplyResult> {
  const existing = await prisma.bankTransaction.findUnique({
    where: { provider_externalId: { provider: txn.provider, externalId: txn.externalId } },
  });
  if (existing) return { outcome: "duplicate", bankTransactionId: existing.id };

  const record = {
    provider: txn.provider,
    externalId: txn.externalId,
    direction: txn.direction,
    amountVnd: txn.amountVnd,
    content: txn.content,
    bankAccount: txn.bankAccount,
    occurredAt: txn.occurredAt,
    raw: txn.raw as Prisma.InputJsonValue,
  };

  // Ignore transfers into some other account SePay also watches.
  const wrongAccount = txn.bankAccount && config.vietqr.accountNo && txn.bankAccount !== config.vietqr.accountNo;
  const order =
    txn.direction === "in" && txn.amountVnd > 0 && !wrongAccount
      ? await prisma.topupOrder.findFirst({ where: { code: { in: extractOrderCodes(txn.content) } } })
      : null;

  try {
    if (!order) {
      const status = txn.direction === "in" && txn.amountVnd > 0 && !wrongAccount ? "UNMATCHED" : "IGNORED";
      const row = await prisma.bankTransaction.create({ data: { ...record, status } });
      if (status === "UNMATCHED") console.warn(`Unmatched incoming transfer ${row.id}: ${txn.amountVnd} VND "${txn.content}"`);
      return { outcome: status === "UNMATCHED" ? "unmatched" : "ignored", bankTransactionId: row.id };
    }
    return await creditOrder(order, txn.amountVnd, record);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // A concurrent retry of the same webhook won the race.
      const row = await prisma.bankTransaction.findUniqueOrThrow({
        where: { provider_externalId: { provider: txn.provider, externalId: txn.externalId } },
      });
      return { outcome: "duplicate", bankTransactionId: row.id };
    }
    throw err;
  }
}

// Credits what was actually received (at the order's locked rate), even if
// it differs from the order amount; a second transfer to the same code adds up.
async function creditOrder(
  order: TopupOrder,
  amountVnd: number,
  record: Omit<Prisma.BankTransactionUncheckedCreateInput, "status">,
): Promise<ApplyResult> {
  const credit = vndToMicros(amountVnd, order.vndPerUsd);
  return prisma.$transaction(async (tx) => {
    const row = await tx.bankTransaction.create({
      data: { ...record, status: "MATCHED", orderId: order.id, accountId: order.accountId },
    });
    await tx.topupOrder.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paidAt: order.paidAt ?? new Date(),
        paidAmountVnd: { increment: amountVnd },
        creditMicros: { increment: credit },
      },
    });
    await creditInTransaction(tx, {
      accountId: order.accountId,
      type: "TOPUP",
      amountMicros: credit,
      reference: `${record.provider}:${record.externalId}`,
      note: `VietQR ${order.code}: ${amountVnd.toLocaleString("en-US")} VND @ ${order.vndPerUsd} VND/USD`,
    });
    return { outcome: "credited", bankTransactionId: row.id, orderId: order.id, accountId: order.accountId, creditedUsd: microsToUsd(credit) };
  });
}

// Manual reconciliation of an UNMATCHED transfer (customer typed the memo
// wrong): credit it to an account at the current rate.
export async function assignBankTransaction(bankTransactionId: string, accountId: string) {
  const row = await prisma.bankTransaction.findUnique({ where: { id: bankTransactionId } });
  if (!row) throw notFound("Bank transaction");
  if (row.status !== "UNMATCHED") throw conflict(`Only UNMATCHED transactions can be assigned (this one is ${row.status})`);
  const vndPerUsd = config.vietqr.vndPerUsd;
  const credit = vndToMicros(row.amountVnd, vndPerUsd);

  return prisma.$transaction(async (tx) => {
    // Guarded update so two admins can't both assign the same transfer.
    const claimed = await tx.bankTransaction.updateMany({
      where: { id: row.id, status: "UNMATCHED" },
      data: { status: "MATCHED", accountId },
    });
    if (claimed.count === 0) throw conflict("Transaction was assigned concurrently");
    const creditTx = await creditInTransaction(tx, {
      accountId,
      type: "TOPUP",
      amountMicros: credit,
      reference: `${row.provider}:${row.externalId}`,
      note: `Manual VietQR assignment: ${row.amountVnd.toLocaleString("en-US")} VND @ ${vndPerUsd} VND/USD`,
    });
    return { bankTransactionId: row.id, accountId, creditedUsd: microsToUsd(creditTx.amountMicros) };
  });
}

export async function listBankTransactions(status: "MATCHED" | "UNMATCHED" | "IGNORED" | undefined, limit: number) {
  const rows = await prisma.bankTransaction.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(({ raw: _raw, ...r }) => r);
}
