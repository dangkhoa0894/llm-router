import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

// Upstream provider API keys aren't listed here: each RouterProvider row
// names the env var it reads (e.g. DEEPINFRA_API_KEY).
export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Bearer token for /api/admin/*; the admin API is disabled when unset.
  adminToken: optional("ROUTER_ADMIN_TOKEN"),
  // Public self-serve signup (POST /api/signup). Off by default — there is
  // no email verification yet, so free credit would be farmable.
  signupEnabled: process.env.ROUTER_SIGNUP_ENABLED === "true",
  signupCreditUsd: Number(process.env.ROUTER_SIGNUP_CREDIT_USD ?? 0),
  // Default sell-price markup over upstream cost used by the seed script.
  defaultMarkup: Number(process.env.ROUTER_DEFAULT_MARKUP ?? 0.2),
  // VietQR bank-transfer top-ups (see src/payments). Disabled unless the
  // receiving bank account is configured.
  vietqr: {
    bankBin: optional("VIETQR_BANK_BIN"), // 6-digit NAPAS BIN, e.g. 970422 (MB Bank)
    bankName: process.env.VIETQR_BANK_NAME ?? "",
    accountNo: optional("VIETQR_ACCOUNT_NO"),
    accountName: process.env.VIETQR_ACCOUNT_NAME ?? "",
    vndPerUsd: Number(process.env.VIETQR_VND_PER_USD ?? 26000),
    minVnd: Number(process.env.VIETQR_MIN_VND ?? 10000),
    maxVnd: Number(process.env.VIETQR_MAX_VND ?? 50_000_000),
    orderTtlMinutes: Number(process.env.VIETQR_ORDER_TTL_MINUTES ?? 30),
    // Transfer memos look like <prefix><8 chars>; letters/digits only, since
    // banks strip or mangle punctuation in memos.
    codePrefix: (process.env.TOPUP_CODE_PREFIX ?? "LLMR").toUpperCase(),
  },
  // Secret SePay sends with every webhook (Authorization: Apikey <key>).
  sepayWebhookApiKey: optional("SEPAY_WEBHOOK_API_KEY"),
};
