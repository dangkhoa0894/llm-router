import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "sk-rt-";
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 6;

export function generateApiKey(): { plaintext: string; prefix: string; keyHash: string } {
  const plaintext = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { plaintext, prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH), keyHash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}
