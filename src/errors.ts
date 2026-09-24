import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "./lib/httpError";

// OpenAI-shaped errors, so existing OpenAI SDKs surface them properly.
export class OpenAiError extends HttpError {
  type: string;
  code: string | null;

  constructor(status: number, message: string, type: string, code: string | null = null) {
    super(status, message);
    this.type = type;
    this.code = code;
  }
}

export const invalidRequest = (message: string, code: string | null = null) =>
  new OpenAiError(400, message, "invalid_request_error", code);
export const unauthorized = (message = "Invalid API key") =>
  new OpenAiError(401, message, "invalid_request_error", "invalid_api_key");
export const insufficientCredit = () =>
  new OpenAiError(402, "Insufficient credit balance, please top up your account", "insufficient_quota", "insufficient_quota");
export const modelNotFound = (model: string) =>
  new OpenAiError(404, `The model \`${model}\` does not exist or is not available`, "invalid_request_error", "model_not_found");
export const rateLimited = (limit: number) =>
  new OpenAiError(429, `Rate limit reached: ${limit} requests per minute`, "rate_limit_error", "rate_limit_exceeded");
export const upstreamUnavailable = (message: string) => new OpenAiError(502, message, "api_error", "upstream_error");

export function openAiErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof OpenAiError) {
    res.status(err.status).json({ error: { message: err.message, type: err.type, code: err.code } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    res.status(400).json({ error: { message, type: "invalid_request_error", code: null } });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, type: "invalid_request_error", code: null } });
    return;
  }
  // express.json() parse errors carry a status (400 / 413).
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: { message: (err as Error).message, type: "invalid_request_error", code: null } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { message: "Internal server error", type: "api_error", code: null } });
}
