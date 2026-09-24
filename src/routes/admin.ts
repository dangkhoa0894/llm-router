import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAdmin } from "../auth";
import { adjustCredit } from "../billing";
import { usdToMicros } from "../money";
import * as routerService from "../service";
import * as serialize from "../serialize";
import {
  createAccountSchema,
  createDeploymentSchema,
  createKeySchema,
  createModelSchema,
  createProviderSchema,
  creditSchema,
  daysQuerySchema,
  limitQuerySchema,
  updateAccountSchema,
  updateDeploymentSchema,
  updateModelSchema,
  updateProviderSchema,
  assignBankTransactionSchema,
  bankTransactionQuerySchema,
} from "../validation";
import { prisma } from "../lib/prisma";
import * as topups from "../payments/topups";

// Operator back-office: catalog, pricing, customers, credit, reporting.
export const adminRouter = Router();

adminRouter.use(requireAdmin);

// ---- providers ----
adminRouter.get("/providers", asyncHandler(async (_req, res) => res.json(await routerService.listProviders())));
adminRouter.post(
  "/providers",
  asyncHandler(async (req, res) => res.status(201).json(await routerService.createProvider(createProviderSchema.parse(req.body)))),
);
adminRouter.patch(
  "/providers/:id",
  asyncHandler(async (req, res) => res.json(await routerService.updateProvider(req.params.id, updateProviderSchema.parse(req.body)))),
);

// ---- models & deployments ----
adminRouter.get("/models", asyncHandler(async (_req, res) => res.json(await routerService.listModels())));
adminRouter.post(
  "/models",
  asyncHandler(async (req, res) => res.status(201).json(await routerService.createModel(createModelSchema.parse(req.body)))),
);
adminRouter.get("/models/:id", asyncHandler(async (req, res) => res.json(await routerService.getModel(req.params.id))));
adminRouter.patch(
  "/models/:id",
  asyncHandler(async (req, res) => res.json(await routerService.updateModel(req.params.id, updateModelSchema.parse(req.body)))),
);
adminRouter.post(
  "/models/:id/deployments",
  asyncHandler(async (req, res) =>
    res.status(201).json(await routerService.createDeployment(req.params.id, createDeploymentSchema.parse(req.body))),
  ),
);
adminRouter.patch(
  "/deployments/:id",
  asyncHandler(async (req, res) => res.json(await routerService.updateDeployment(req.params.id, updateDeploymentSchema.parse(req.body)))),
);
adminRouter.delete(
  "/deployments/:id",
  asyncHandler(async (req, res) => {
    await routerService.deleteDeployment(req.params.id);
    res.status(204).send();
  }),
);

// ---- accounts, keys, credit ----
adminRouter.get("/accounts", asyncHandler(async (_req, res) => res.json(await routerService.listAccounts())));
adminRouter.post(
  "/accounts",
  asyncHandler(async (req, res) => res.status(201).json(await routerService.createAccount(createAccountSchema.parse(req.body)))),
);
adminRouter.get(
  "/accounts/:id",
  asyncHandler(async (req, res) => {
    const account = await routerService.getAccountOrThrow(req.params.id);
    res.json({ ...serialize.account(account), apiKeys: await routerService.listApiKeys(account.id) });
  }),
);
adminRouter.patch(
  "/accounts/:id",
  asyncHandler(async (req, res) => {
    const input = updateAccountSchema.parse(req.body);
    await routerService.getAccountOrThrow(req.params.id);
    res.json(serialize.account(await prisma.routerAccount.update({ where: { id: req.params.id }, data: input })));
  }),
);
adminRouter.post(
  "/accounts/:id/credits",
  asyncHandler(async (req, res) => {
    const input = creditSchema.parse(req.body);
    const tx = await adjustCredit({
      accountId: req.params.id,
      type: input.type,
      amountMicros: usdToMicros(input.amountUsd),
      reference: input.reference,
      note: input.note,
    });
    res.status(201).json(serialize.transaction(tx));
  }),
);
adminRouter.get(
  "/accounts/:id/transactions",
  asyncHandler(async (req, res) => {
    const { limit } = limitQuerySchema.parse(req.query);
    res.json(await routerService.listTransactions(req.params.id, limit));
  }),
);
adminRouter.get(
  "/accounts/:id/usage",
  asyncHandler(async (req, res) => {
    const { days } = daysQuerySchema.parse(req.query);
    res.json(await routerService.usageByDay(days, req.params.id));
  }),
);
adminRouter.post(
  "/accounts/:id/keys",
  asyncHandler(async (req, res) => {
    await routerService.getAccountOrThrow(req.params.id);
    const { name } = createKeySchema.parse(req.body ?? {});
    res.status(201).json(await routerService.createApiKey(req.params.id, name));
  }),
);
adminRouter.delete("/keys/:id", asyncHandler(async (req, res) => res.json(await routerService.revokeApiKey(req.params.id))));

// ---- reporting ----
adminRouter.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const { days } = daysQuerySchema.parse(req.query);
    res.json(await routerService.usageByDay(days));
  }),
);
adminRouter.get(
  "/requests",
  asyncHandler(async (req, res) => {
    const { limit } = limitQuerySchema.parse(req.query);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await routerService.listRequests(accountId ? { accountId } : {}, limit, true));
  }),
);

// ---- payments (VietQR) ----
adminRouter.get(
  "/topups",
  asyncHandler(async (req, res) => {
    const { limit } = limitQuerySchema.parse(req.query);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await topups.listTopupOrders(accountId ? { accountId } : {}, limit));
  }),
);
adminRouter.get(
  "/bank-transactions",
  asyncHandler(async (req, res) => {
    const { status, limit } = bankTransactionQuerySchema.parse(req.query);
    res.json(await topups.listBankTransactions(status, limit));
  }),
);
adminRouter.post(
  "/bank-transactions/:id/assign",
  asyncHandler(async (req, res) => {
    const { accountId } = assignBankTransactionSchema.parse(req.body);
    await routerService.getAccountOrThrow(accountId);
    res.status(201).json(await topups.assignBankTransaction(req.params.id, accountId));
  }),
);
