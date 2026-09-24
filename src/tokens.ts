// Fallback when an upstream returns no `usage` (some providers omit it on
// streams, or the client disconnected before the final chunk). ~4 chars per
// token is the usual rough average for English; Vietnamese runs a bit higher.
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function estimatePromptTokens(body: Record<string, unknown>): number {
  const source = body.messages ?? body.prompt ?? body.input ?? "";
  return estimateTokens(typeof source === "string" ? source : JSON.stringify(source));
}
