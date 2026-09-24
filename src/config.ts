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
};
