import { Router } from "express";
import { config } from "../config";
import { HttpError } from "../lib/httpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireApiKey, routerAuth } from "../auth";
import * as routerService from "../service";
import * as serialize from "../serialize";
import { createKeySchema, daysQuerySchema, limitQuerySchema, signupSchema } from "../validation";

// Customer self-service, authenticated with the customer's own API key.
export const accountRouter = Router();

accountRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    if (!config.signupEnabled) throw new HttpError(403, "Self-serve signup is disabled");
    const input = signupSchema.parse(req.body);
    res.status(201).json(await routerService.createAccount({ ...input, initialCreditUsd: config.signupCreditUsd }));
  }),
);

accountRouter.use("/me", requireApiKey);

accountRouter.get(
  "/me",
  asyncHandler(async (_req, res) => {
    res.json(serialize.account(await routerService.getAccountOrThrow(routerAuth(res).account.id)));
  }),
);

accountRouter.get(
  "/me/usage",
  asyncHandler(async (req, res) => {
    const { days } = daysQuerySchema.parse(req.query);
    res.json(await routerService.usageByDay(days, routerAuth(res).account.id));
  }),
);

accountRouter.get(
  "/me/requests",
  asyncHandler(async (req, res) => {
    const { limit } = limitQuerySchema.parse(req.query);
    res.json(await routerService.listRequests({ accountId: routerAuth(res).account.id }, limit));
  }),
);

accountRouter.get(
  "/me/transactions",
  asyncHandler(async (req, res) => {
    const { limit } = limitQuerySchema.parse(req.query);
    res.json(await routerService.listTransactions(routerAuth(res).account.id, limit));
  }),
);

accountRouter.get(
  "/me/keys",
  asyncHandler(async (_req, res) => {
    res.json(await routerService.listApiKeys(routerAuth(res).account.id));
  }),
);

accountRouter.post(
  "/me/keys",
  asyncHandler(async (req, res) => {
    const { name } = createKeySchema.parse(req.body ?? {});
    res.status(201).json(await routerService.createApiKey(routerAuth(res).account.id, name));
  }),
);

accountRouter.delete(
  "/me/keys/:keyId",
  asyncHandler(async (req, res) => {
    res.json(await routerService.revokeApiKey(req.params.keyId, routerAuth(res).account.id));
  }),
);
