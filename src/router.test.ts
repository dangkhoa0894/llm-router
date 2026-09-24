import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { RouterDeployment } from "@prisma/client";
import { recordFailure, resetHealth } from "./health";
import { priceTokens, usdToMicros } from "./money";
import { resetRateLimits, tryConsume } from "./rateLimit";
import { orderCandidates } from "./routing";
import { eventData, SseParser } from "./sse";

const dep = (id: string, over: Partial<RouterDeployment> = {}): RouterDeployment => ({
  id,
  modelId: "m",
  providerId: "p",
  upstreamModel: id,
  priority: 0,
  weight: 1,
  inputCostPerMTokMicros: 0n,
  outputCostPerMTokMicros: 0n,
  isEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe("priceTokens", () => {
  it("prices per 1M tokens in micros", () => {
    // 1M input at $0.50/M + 500k output at $1.00/M = $1.00
    assert.equal(priceTokens(1_000_000, 500_000, usdToMicros(0.5), usdToMicros(1)), 1_000_000n);
  });

  it("rounds tiny requests up to one micro-USD", () => {
    assert.equal(priceTokens(1, 0, usdToMicros(0.1), 0n), 1n);
    assert.equal(priceTokens(0, 0, usdToMicros(0.1), 0n), 0n);
  });
});

describe("orderCandidates", () => {
  beforeEach(resetHealth);

  it("PRIORITY sorts by priority", () => {
    const out = orderCandidates("PRIORITY", [dep("b", { priority: 2 }), dep("a", { priority: 1 })]);
    assert.deepEqual(out.map((d) => d.id), ["a", "b"]);
  });

  it("LOWEST_COST sorts by upstream cost, then priority", () => {
    const out = orderCandidates("LOWEST_COST", [
      dep("pricey", { inputCostPerMTokMicros: 900n, outputCostPerMTokMicros: 900n }),
      dep("cheap-2", { priority: 2, inputCostPerMTokMicros: 100n }),
      dep("cheap-1", { priority: 1, inputCostPerMTokMicros: 100n }),
    ]);
    assert.deepEqual(out.map((d) => d.id), ["cheap-1", "cheap-2", "pricey"]);
  });

  it("WEIGHTED picks proportionally and keeps every candidate", () => {
    const out = orderCandidates("WEIGHTED", [dep("a", { weight: 1 }), dep("b", { weight: 3 })], () => 0.5);
    assert.deepEqual(out.map((d) => d.id), ["b", "a"]);
  });

  it("moves deployments with a tripped circuit to the end", () => {
    for (let i = 0; i < 3; i++) recordFailure("a", "boom");
    const out = orderCandidates("PRIORITY", [dep("a", { priority: 0 }), dep("b", { priority: 1 })]);
    assert.deepEqual(out.map((d) => d.id), ["b", "a"]);
  });
});

describe("tryConsume", () => {
  beforeEach(resetRateLimits);

  it("allows up to the limit within a minute, then recovers", () => {
    assert.equal(tryConsume("acc", 2, 0), true);
    assert.equal(tryConsume("acc", 2, 1), true);
    assert.equal(tryConsume("acc", 2, 2), false);
    assert.equal(tryConsume("acc", 2, 60_001), true);
  });
});

describe("SseParser", () => {
  it("reassembles events split across chunks", () => {
    const parser = new SseParser();
    assert.deepEqual(parser.push('data: {"a"'), []);
    assert.deepEqual(parser.push(':1}\n\ndata: [DONE]\r\n\r\n: ping'), ['data: {"a":1}', "data: [DONE]"]);
    assert.deepEqual(parser.flush(), [": ping"]);
  });

  it("extracts data payloads", () => {
    assert.equal(eventData('data: {"x":1}'), '{"x":1}');
    assert.equal(eventData("data: a\ndata: b"), "a\nb");
    assert.equal(eventData(": keep-alive"), null);
  });
});
