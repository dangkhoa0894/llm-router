# llm-router

An LLM API business in a box: customers get one **OpenAI-compatible
API** (`/v1`) and a prepaid credit balance; behind it, each model you sell is routed across one or
more upstream providers (DeepInfra, OpenAI, Gemini, Groq, Together, a self-hosted vLLM — anything
OpenAI-compatible), with automatic fallback, and every request is metered and billed per token.

```
customer ──(sk-rt-… key)──▶ /v1/chat/completions ──▶ auth · credit check · rate limit
                                                   ──▶ pick deployment (PRIORITY | LOWEST_COST | WEIGHTED)
                                                   ──▶ upstream #1 ✗ 5xx/429/timeout ──▶ upstream #2 ✓
                                                   ──▶ usage → charge (sell price) + cost (upstream price) → ledger
```

## Quick start

```bash
cp .env.example .env    # set ROUTER_ADMIN_TOKEN=<random secret>, DEEPINFRA_API_KEY (+ other provider keys)
docker compose up -d postgres
npm install
npm run prisma:migrate  # creates the tables
npm run seed            # starter catalog: providers, models, deployments, prices (placeholder costs!)
npm run dev             # http://localhost:3000

# create a customer with $5 credit — the response contains their API key (shown once)
curl -X POST localhost:3000/api/admin/accounts \
  -H "Authorization: Bearer $ROUTER_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Acme", "email": "dev@acme.vn", "initialCreditUsd": 5}'
```

Customers then use any OpenAI SDK:

```python
from openai import OpenAI
client = OpenAI(api_key="sk-rt-...", base_url="https://your-host/v1")
client.chat.completions.create(model="meta-llama/Llama-3.3-70B-Instruct",
                               messages=[{"role": "user", "content": "Xin chào"}], stream=True)
```

Pages: `/models.html` (public price list) and `/console.html` (customer console: balance, usage,
transactions, API keys, streaming playground).

## API

| Who | Endpoint | |
|---|---|---|
| public | `GET /v1/models` | catalog with `pricing` (USD per 1M tokens) |
| customer key | `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings` | streaming supported |
| customer key | `GET /api/me`, `/me/usage?days=`, `/me/requests`, `/me/transactions` | |
| customer key | `GET/POST /api/me/keys`, `DELETE /api/me/keys/:id` | |
| public (opt-in) | `POST /api/signup` | only if `ROUTER_SIGNUP_ENABLED=true` |
| admin token | `GET/POST /api/admin/providers`, `PATCH /api/admin/providers/:id` | upstream hosts |
| admin token | `GET/POST /api/admin/models`, `GET/PATCH /api/admin/models/:id` | sell price, routing strategy |
| admin token | `POST /api/admin/models/:id/deployments`, `PATCH/DELETE /api/admin/deployments/:id` | upstream model, cost, priority/weight |
| admin token | `GET/POST /api/admin/accounts`, `GET/PATCH /api/admin/accounts/:id`, `POST /api/admin/accounts/:id/keys` | customers, suspend, RPM limit |
| admin token | `POST /api/admin/accounts/:id/credits` | `{amountUsd, type: TOPUP\|REFUND\|ADJUSTMENT, reference}` — `reference` makes it idempotent |
| customer key | `POST /api/me/topups {amountVnd}`, `GET /api/me/topups[/:id]`, `DELETE /api/me/topups/:id` | VietQR top-up orders (see below) |
| SePay | `POST /api/payments/sepay/webhook` | bank-transfer notifications |
| admin token | `GET /api/admin/topups`, `GET /api/admin/bank-transactions?status=UNMATCHED`, `POST /api/admin/bank-transactions/:id/assign {accountId}` | payment review & manual reconciliation |
| admin token | `GET /api/admin/usage?days=`, `GET /api/admin/requests?accountId=` | revenue, upstream cost, margin; request log |

## How it behaves

- **Money** is BigInt micro-USD; prices are per 1M tokens. Charge = customer's sell price × tokens;
  cost = the serving deployment's upstream price × tokens; both are stored per request so margin is
  reportable. Every debit/credit is a `CreditTransaction` row (append-only ledger).
- **Credit**: requests are refused with `402 insufficient_quota` once the balance is ≤ 0. The request
  that exhausts it can take the balance slightly negative (output size isn't known in advance).
- **Fallback**: upstream network errors, timeouts (`timeoutMs` until response headers), 401/403/404/408/409/425/429/5xx
  move on to the next deployment; other 4xx (e.g. context too long) are relayed to the customer as-is.
  3 consecutive failures trip a deployment's circuit for 30s (visible under `health` in the admin model view).
- **Streaming**: the router forces `stream_options.include_usage` upstream to bill exact tokens, and strips
  that extra usage chunk unless the customer asked for it. If the upstream sends no usage, or the customer
  disconnects mid-stream (the upstream call is then aborted), tokens are estimated from text length and the
  request is flagged `usageEstimated`.
- **Rate limit**: per account, `rpmLimit` requests/minute (default 60).
- **Secrets**: provider API keys are never stored in the DB — each provider names the env var it reads,
  and deployments whose key isn't set are skipped.

## Top-ups with VietQR

Customers top up by bank transfer — any Vietnamese banking app can pay it:

1. `POST /api/me/topups {"amountVnd": 200000}` (or the console's "Nạp tiền" box) opens an order with a
   unique memo like `LLMR7K2Q9XTA` and returns a VietQR code (`payment.qrImage` PNG data URL and the raw
   `payment.qrPayload`). The QR is built locally to the NAPAS/EMVCo spec — no third-party QR service.
2. The customer scans and pays; [SePay](https://sepay.vn) watches the receiving account and calls
   `POST /api/payments/sepay/webhook`.
3. The router finds the order code in the transfer memo and credits the **amount actually received**,
   converted at the VND/USD rate locked when the order was created. The order turns `PAID` (the console
   polls it and updates the balance).

Details:
- **Idempotent**: each bank transaction is recorded once per `(provider, id)`, so SePay retries (even
  concurrent ones) never double-credit; the credit ledger reference is `sepay:<id>`.
- A second transfer to the same code adds to the order; a transfer arriving after the order expired is
  still credited (expiry only hides the QR).
- Transfers with no recognizable code are stored as `UNMATCHED` — review them with
  `GET /api/admin/bank-transactions?status=UNMATCHED` and credit the right customer with
  `POST /api/admin/bank-transactions/:id/assign`. Outgoing transfers, or transfers into a different account
  SePay also watches, are stored as `IGNORED`.

Setup:
1. Set `VIETQR_BANK_BIN`, `VIETQR_ACCOUNT_NO`, `VIETQR_ACCOUNT_NAME`, `VIETQR_BANK_NAME`, `VIETQR_VND_PER_USD`.
2. In SePay, link that bank account and add a webhook to `https://<your-host>/api/payments/sepay/webhook`
   with **API Key** authentication; put the same key in `SEPAY_WEBHOOK_API_KEY`.
3. Send a small real transfer and check it appears under `GET /api/admin/bank-transactions`.

> The SePay payload fields (`id`, `transferType`, `transferAmount`, `content`, `accountNumber`,
> `transactionDate`…) and the `Authorization: Apikey <key>` header follow SePay's documented webhook
> format; parsing is lenient, but confirm against your SePay dashboard's test webhook before going live.

## Before going to production

- Replace the placeholder upstream costs in `src/seed.ts` with current provider prices.
- VietQR top-ups are built in (above). For card payments (Stripe) add another webhook route that
  calls `adjustCredit` with the gateway transaction id as `reference`.
- Update `VIETQR_VND_PER_USD` as the exchange rate moves (orders keep the rate they were opened with).
- The rate limiter and circuit breaker are in-memory (per process): move them to Redis before running
  more than one replica.
- Signup has no email verification yet; keep `ROUTER_SIGNUP_CREDIT_USD=0` until it does.

## Deploy with Docker

```bash
docker compose up -d --build   # Postgres + app; migrations run on boot
docker compose exec app npx tsx src/seed.ts   # or seed from the host: npm run seed
```

## Development

```bash
npm run typecheck
npm test
```
