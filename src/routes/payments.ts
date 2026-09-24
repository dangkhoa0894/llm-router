import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { HttpError } from "../lib/httpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { parseSepayWebhook, sepayKeyFromHeader } from "../payments/sepay";
import { applyBankTransaction } from "../payments/topups";

// Inbound payment notifications from bank-feed providers.
export const paymentsRouter = Router();

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

paymentsRouter.post(
  "/sepay/webhook",
  asyncHandler(async (req, res) => {
    const expected = config.sepayWebhookApiKey;
    if (!expected) throw new HttpError(503, "SePay webhook is not configured: set SEPAY_WEBHOOK_API_KEY");
    const provided = sepayKeyFromHeader(req.header("authorization"));
    if (!provided || !safeEqual(provided, expected)) throw new HttpError(401, "Invalid webhook API key");

    const result = await applyBankTransaction(parseSepayWebhook(req.body));
    // Any 2xx with success=true tells SePay not to retry — including for
    // duplicates and transfers we don't recognize (those are stored for review).
    res.status(200).json({ success: true, ...result });
  }),
);
