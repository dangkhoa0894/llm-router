// SePay (sepay.vn) watches the receiving bank account and POSTs every
// transaction to our webhook. Parsing is deliberately lenient (numbers may
// arrive as strings, optional fields may be null) — only the fields we
// need are required.
import { z } from "zod";

const sepayWebhookSchema = z
  .object({
    id: z.union([z.number(), z.string()]).transform(String),
    gateway: z.string().nullish(), // bank name
    transactionDate: z.string().nullish(), // "YYYY-MM-DD HH:mm:ss", Vietnam time
    accountNumber: z.string().nullish(),
    code: z.string().nullish(), // payment code SePay itself detected, if configured
    content: z.string().nullish(),
    description: z.string().nullish(),
    transferType: z.string(), // "in" | "out"
    transferAmount: z.coerce.number().int().nonnegative(),
    referenceCode: z.string().nullish(),
  })
  .passthrough();

export interface NormalizedBankTransaction {
  provider: string;
  externalId: string;
  direction: "in" | "out";
  amountVnd: number;
  content: string;
  bankAccount?: string;
  occurredAt?: Date;
  raw: unknown;
}

export function parseSepayWebhook(body: unknown): NormalizedBankTransaction {
  const tx = sepayWebhookSchema.parse(body);
  return {
    provider: "sepay",
    externalId: tx.id,
    direction: tx.transferType.toLowerCase() === "in" ? "in" : "out",
    amountVnd: tx.transferAmount,
    // Search the SePay-detected code too, in case the bank memo got mangled.
    content: [tx.content, tx.description, tx.code].filter(Boolean).join(" | "),
    bankAccount: tx.accountNumber ?? undefined,
    occurredAt: tx.transactionDate ? parseVietnamTime(tx.transactionDate) : undefined,
    raw: body,
  };
}

function parseVietnamTime(value: string): Date | undefined {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`);
}

// SePay's "API Key" auth sends `Authorization: Apikey <key>`; accept Bearer too.
export function sepayKeyFromHeader(header: string | undefined): string | undefined {
  return header?.match(/^(?:Apikey|Bearer)\s+(.+)$/i)?.[1].trim();
}
