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

## Before going to production

- Replace the placeholder upstream costs in `src/seed.ts` with current provider prices.
- Wire a payment gateway (Stripe / VNPay / MoMo / bank-transfer webhooks) to call the credits endpoint
  with the gateway transaction id as `reference`.
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
