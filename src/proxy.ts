import type { Request, Response } from "express";
import { recordRequest, type RequestRecord } from "./billing";
import { routerAuth } from "./auth";
import { insufficientCredit, invalidRequest, modelNotFound, rateLimited, upstreamUnavailable } from "./errors";
import { recordFailure, recordSuccess } from "./health";
import { priceTokens } from "./money";
import { tryConsume } from "./rateLimit";
import { loadRoutableModel, orderCandidates, type Candidate, type RoutableModel } from "./routing";
import { eventData, SseParser } from "./sse";
import { estimatePromptTokens, estimateTokens } from "./tokens";

export type Endpoint = "chat/completions" | "completions" | "embeddings";

interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

// Upstream statuses worth retrying on another deployment. Other 4xx mean the
// customer's request itself is bad, so they are relayed as-is.
const RETRYABLE_STATUSES = new Set([401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504]);

class ClientGone extends Error {}

export async function handleInference(req: Request, res: Response, endpoint: Endpoint) {
  const startedAt = Date.now();
  const { account, apiKey } = routerAuth(res);
  const body = req.body as Record<string, unknown> | undefined;

  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest("Request body must be a JSON object");
  if (typeof body.model !== "string" || body.model.length === 0) throw invalidRequest("`model` is required", "missing_model");

  const model = await loadRoutableModel(body.model);
  const expectedType = endpoint === "embeddings" ? "EMBEDDING" : "CHAT";
  if (!model) throw modelNotFound(body.model);
  if (model.type !== expectedType) {
    const kind = model.type === "EMBEDDING" ? "an embedding" : "a chat";
    throw invalidRequest(`Model \`${model.slug}\` is ${kind} model and can't be used with /v1/${endpoint}`);
  }
  if (account.balanceMicros <= 0n) throw insufficientCredit();
  if (!tryConsume(account.id, account.rpmLimit)) throw rateLimited(account.rpmLimit);

  const stream = endpoint !== "embeddings" && body.stream === true;
  const base: Omit<RequestRecord, "status" | "httpStatus" | "attempts" | "latencyMs"> = {
    accountId: account.id,
    apiKeyId: apiKey.id,
    modelId: model.id,
    modelSlug: model.slug,
    endpoint,
    stream,
  };

  const candidates = orderCandidates(model.strategy, model.candidates);
  if (candidates.length === 0) {
    await recordRequest({ ...base, status: "ERROR", httpStatus: 503, errorMessage: "No deployment configured", attempts: 0, latencyMs: 0 });
    throw upstreamUnavailable(`Model \`${model.slug}\` has no available deployment right now`);
  }

  // Abort whichever upstream call is in flight if the customer hangs up.
  let current: AbortController | undefined;
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableFinished) {
      clientGone = true;
      current?.abort(new ClientGone());
    }
  });

  let attempts = 0;
  let lastError = "unknown error";
  for (const candidate of candidates) {
    if (clientGone) return;
    attempts += 1;
    current = new AbortController();
    const controller = current;
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${candidate.provider.timeoutMs}ms`)), candidate.provider.timeoutMs);

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${candidate.provider.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${candidate.apiKey}` },
        body: JSON.stringify(upstreamBody(body, candidate, stream)),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (clientGone) return;
      lastError = `${candidate.provider.slug}: ${describeAbort(controller, err)}`;
      recordFailure(candidate.id, lastError);
      continue;
    }
    clearTimeout(timer);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      if (RETRYABLE_STATUSES.has(upstream.status)) {
        lastError = `${candidate.provider.slug}: HTTP ${upstream.status} ${text.slice(0, 300)}`;
        recordFailure(candidate.id, lastError);
        continue;
      }
      // The provider is fine; the request isn't. Relay the upstream error.
      recordSuccess(candidate.id);
      await recordRequest({
        ...base,
        deploymentId: candidate.id,
        status: "ERROR",
        httpStatus: upstream.status,
        errorMessage: text.slice(0, 2000),
        attempts,
        latencyMs: Date.now() - startedAt,
      });
      res.status(upstream.status).type("application/json").send(text || JSON.stringify({ error: { message: "Upstream error", type: "api_error" } }));
      return;
    }

    recordSuccess(candidate.id);
    const finish = async (usage: Usage, errorMessage?: string) => {
      await recordRequest({
        ...base,
        deploymentId: candidate.id,
        status: errorMessage ? "ERROR" : "SUCCESS",
        httpStatus: 200,
        errorMessage,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        usageEstimated: usage.estimated,
        costMicros: priceTokens(usage.inputTokens, usage.outputTokens, candidate.inputCostPerMTokMicros, candidate.outputCostPerMTokMicros),
        chargeMicros: priceTokens(usage.inputTokens, usage.outputTokens, model.inputPricePerMTokMicros, model.outputPricePerMTokMicros),
        attempts,
        latencyMs: Date.now() - startedAt,
      });
    };

    if (stream) {
      await relayStream(res, upstream, body, model, controller, finish);
    } else {
      await relayJson(res, upstream, body, model, finish);
    }
    return;
  }

  await recordRequest({ ...base, status: "ERROR", httpStatus: 502, errorMessage: lastError.slice(0, 2000), attempts, latencyMs: Date.now() - startedAt });
  // Don't leak which upstream failed to the customer.
  throw upstreamUnavailable(`All upstream providers for \`${model.slug}\` failed, please retry`);
}

function upstreamBody(body: Record<string, unknown>, candidate: Candidate, stream: boolean) {
  const out: Record<string, unknown> = { ...body, model: candidate.upstreamModel };
  if (stream) {
    const streamOptions = typeof body.stream_options === "object" && body.stream_options ? body.stream_options : {};
    out.stream_options = { ...streamOptions, include_usage: true };
  }
  return out;
}

function describeAbort(controller: AbortController, err: unknown): string {
  const reason = controller.signal.aborted ? controller.signal.reason : err;
  return reason instanceof Error ? reason.message : String(reason);
}

function readUsage(raw: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens);
  if (!Number.isFinite(input)) return null;
  const total = Number(usage.total_tokens);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? (Number.isFinite(total) ? total - input : 0));
  return { inputTokens: input, outputTokens: Number.isFinite(completion) ? completion : 0 };
}

async function relayJson(
  res: Response,
  upstream: globalThis.Response,
  body: Record<string, unknown>,
  model: RoutableModel,
  finish: (usage: Usage, errorMessage?: string) => Promise<void>,
) {
  let json: Record<string, unknown>;
  try {
    json = (await upstream.json()) as Record<string, unknown>;
  } catch (err) {
    await finish({ inputTokens: 0, outputTokens: 0, estimated: false }, `invalid upstream JSON: ${(err as Error).message}`);
    throw upstreamUnavailable("Upstream provider returned an invalid response, please retry");
  }
  const reported = readUsage(json.usage);
  const usage: Usage = reported
    ? { ...reported, estimated: false }
    : { inputTokens: estimatePromptTokens(body), outputTokens: estimateTokens(completionText(json)), estimated: true };
  json.model = model.slug;
  await finish(usage);
  res.json(json);
}

async function relayStream(
  res: Response,
  upstream: globalThis.Response,
  body: Record<string, unknown>,
  model: RoutableModel,
  controller: AbortController,
  finish: (usage: Usage, errorMessage?: string) => Promise<void>,
) {
  const clientWantsUsage = (body.stream_options as { include_usage?: boolean } | undefined)?.include_usage === true;
  res.status(200);
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();

  const parser = new SseParser();
  const decoder = new TextDecoder();
  let reported: { inputTokens: number; outputTokens: number } | null = null;
  let generated = "";
  let errorMessage: string | undefined;

  const forward = (event: string) => {
    const data = eventData(event);
    if (data === null || data === "[DONE]") {
      res.write(`${event}\n\n`);
      return;
    }
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data);
    } catch {
      res.write(`${event}\n\n`);
      return;
    }
    reported = readUsage(chunk.usage) ?? reported;
    generated += completionText(chunk);
    chunk.model = model.slug;
    if (!clientWantsUsage && chunk.usage) {
      // We forced include_usage upstream for billing; hide the extra
      // usage-only chunk from clients that didn't ask for it.
      if (Array.isArray(chunk.choices) && chunk.choices.length === 0) return;
      delete chunk.usage;
    }
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  try {
    if (!upstream.body) throw new Error("upstream returned no body");
    for await (const bytes of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      parser.push(decoder.decode(bytes, { stream: true })).forEach(forward);
    }
    parser.push(decoder.decode()).forEach(forward);
    parser.flush().forEach(forward);
  } catch (err) {
    errorMessage = controller.signal.reason instanceof ClientGone ? "client disconnected" : `stream interrupted: ${describeAbort(controller, err)}`;
  }

  const usage: Usage = reported
    ? { ...(reported as { inputTokens: number; outputTokens: number }), estimated: false }
    : { inputTokens: estimatePromptTokens(body), outputTokens: estimateTokens(generated), estimated: true };
  await finish(usage, errorMessage);
  if (!res.writableEnded) res.end();
}

// Text generated in a (chunk of a) chat/completions or completions response.
function completionText(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.choices)) return "";
  return payload.choices
    .map((choice: Record<string, unknown>) => {
      const part = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>;
      const pieces = [part.content, part.reasoning_content, choice.text];
      if (Array.isArray(part.tool_calls)) pieces.push(JSON.stringify(part.tool_calls));
      return pieces.filter((p): p is string => typeof p === "string").join("");
    })
    .join("");
}
