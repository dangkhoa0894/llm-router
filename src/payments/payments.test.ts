import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSepayWebhook, sepayKeyFromHeader } from "./sepay";
import { extractOrderCodes, generateOrderCode, vndToMicros } from "./topups";
import { buildVietQrPayload, crc16 } from "./vietqr";

// Minimal EMV TLV reader, to check the payload round-trips.
function parseTlv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length; ) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe("VietQR payload", () => {
  it("uses CRC-16/CCITT-FALSE (check value of '123456789' is 29B1)", () => {
    assert.equal(crc16("123456789"), "29B1");
  });

  it("encodes bank, account, amount and memo per the NAPAS profile", () => {
    const payload = buildVietQrPayload({ bankBin: "970422", accountNo: "0123456789", amountVnd: 50000, memo: "LLMR7K2Q9XTA" });
    const top = parseTlv(payload);
    assert.equal(top["00"], "01");
    assert.equal(top["01"], "12");
    assert.equal(top["53"], "704");
    assert.equal(top["54"], "50000");
    assert.equal(top["58"], "VN");
    assert.deepEqual(parseTlv(top["62"]), { "08": "LLMR7K2Q9XTA" });
    const merchant = parseTlv(top["38"]);
    assert.equal(merchant["00"], "A000000727");
    assert.equal(merchant["02"], "QRIBFTTA");
    assert.deepEqual(parseTlv(merchant["01"]), { "00": "970422", "01": "0123456789" });
    assert.equal(top["63"], crc16(payload.slice(0, -4)));
  });

  it("rejects malformed bank details", () => {
    assert.throws(() => buildVietQrPayload({ bankBin: "MB", accountNo: "1", amountVnd: 1, memo: "x" }));
    assert.throws(() => buildVietQrPayload({ bankBin: "970422", accountNo: "1", amountVnd: 0, memo: "x" }));
  });
});

describe("order codes", () => {
  it("generates prefix + 8 unambiguous characters", () => {
    assert.match(generateOrderCode("LLMR"), /^LLMR[A-HJ-NP-Z2-9]{8}$/);
  });

  it("finds codes inside real-world bank memos", () => {
    assert.deepEqual(extractOrderCodes("MBVCB.3312.LLMR7K2Q9XTA.CT tu 0123 toi 456", "LLMR"), ["LLMR7K2Q9XTA"]);
    assert.deepEqual(extractOrderCodes("llmr7k2q9xta nap tien", "LLMR"), ["LLMR7K2Q9XTA"]);
    assert.deepEqual(extractOrderCodes("LLMR 7K2Q-9XTA", "LLMR"), ["LLMR7K2Q9XTA"]);
    assert.deepEqual(extractOrderCodes("chuyen tien an trua", "LLMR"), []);
  });

  it("converts VND to credit at the locked rate", () => {
    assert.equal(vndToMicros(260_000, 26_000), 10_000_000n); // $10
  });
});

describe("SePay webhook", () => {
  it("normalizes an incoming transfer", () => {
    const txn = parseSepayWebhook({
      id: 92704,
      gateway: "MBBank",
      transactionDate: "2026-09-24 14:02:37",
      accountNumber: "0123456789",
      code: null,
      content: "LLMR7K2Q9XTA",
      transferType: "in",
      transferAmount: "50000",
      accumulated: 19077000,
      subAccount: null,
      referenceCode: "MBVCB.3278907687",
      description: "",
    });
    assert.equal(txn.externalId, "92704");
    assert.equal(txn.direction, "in");
    assert.equal(txn.amountVnd, 50000);
    assert.equal(txn.occurredAt?.toISOString(), "2026-09-24T07:02:37.000Z");
    assert.match(txn.content, /LLMR7K2Q9XTA/);
  });

  it("reads the API key header", () => {
    assert.equal(sepayKeyFromHeader("Apikey abc123"), "abc123");
    assert.equal(sepayKeyFromHeader("apikey  abc123 "), "abc123");
    assert.equal(sepayKeyFromHeader("Basic abc"), undefined);
  });
});
