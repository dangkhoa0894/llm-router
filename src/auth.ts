import { timingSafeEqual } from "node:crypto";
import type { RouterAccount, RouterApiKey } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { HttpError } from "./lib/httpError";
import { prisma } from "./lib/prisma";
import { OpenAiError, unauthorized } from "./errors";
import { hashApiKey } from "./keys";

export interface RouterAuth {
  account: RouterAccount;
  apiKey: RouterApiKey;
}

const LAST_USED_WRITE_INTERVAL_MS = 60_000;

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1].trim();
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);
    if (!token) throw unauthorized("Missing API key: send `Authorization: Bearer <key>`");

    const apiKey = await prisma.routerApiKey.findUnique({ where: { keyHash: hashApiKey(token) }, include: { account: true } });
    if (!apiKey || apiKey.revokedAt) throw unauthorized();
    if (apiKey.account.status !== "ACTIVE") {
      throw new OpenAiError(403, "This account is suspended", "invalid_request_error", "account_suspended");
    }

    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
      prisma.routerApiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
        .catch((err) => console.error("Failed to update API key lastUsedAt", err));
    }

    const { account, ...key } = apiKey;
    res.locals.routerAuth = { account, apiKey: key } satisfies RouterAuth;
    next();
  } catch (err) {
    next(err);
  }
}

export function routerAuth(res: Response): RouterAuth {
  return res.locals.routerAuth as RouterAuth;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const expected = config.adminToken;
  if (!expected) {
    next(new HttpError(503, "Router admin API is disabled: set ROUTER_ADMIN_TOKEN"));
    return;
  }
  const token = bearerToken(req) ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    next(new HttpError(401, "Invalid admin token"));
    return;
  }
  next();
}
