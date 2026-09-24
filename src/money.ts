// All router money is BigInt micro-USD (see the LLM ROUTER section of
// prisma/schema.prisma). Prices are quoted per 1M tokens.
export const MICROS_PER_USD = 1_000_000n;
const TOKENS_PER_PRICE_UNIT = 1_000_000n;

export function usdToMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function microsToUsd(micros: bigint): number {
  return Number(micros) / 1_000_000;
}

// Rounds up so a request is never billed as free just because it's tiny.
export function priceTokens(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMTok: bigint,
  outputPricePerMTok: bigint,
): bigint {
  const numerator = BigInt(inputTokens) * inputPricePerMTok + BigInt(outputTokens) * outputPricePerMTok;
  return (numerator + TOKENS_PER_PRICE_UNIT - 1n) / TOKENS_PER_PRICE_UNIT;
}
