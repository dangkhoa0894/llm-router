import express, { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireApiKey } from "../auth";
import { openAiErrorHandler } from "../errors";
import { handleInference } from "../proxy";
import * as routerService from "../service";

// OpenAI-compatible surface: point any OpenAI SDK at <host>/v1 with a
// router API key.
export const v1Router = Router();

// Mounted ahead of the app-wide express.json() (100kb default), since
// long-context prompts are routinely several MB.
v1Router.use(express.json({ limit: "20mb" }));

v1Router.get(
  "/models",
  asyncHandler(async (_req, res) => {
    res.json({ object: "list", data: await routerService.listPublicModels() });
  }),
);

v1Router.post("/chat/completions", requireApiKey, asyncHandler((req, res) => handleInference(req, res, "chat/completions")));
v1Router.post("/completions", requireApiKey, asyncHandler((req, res) => handleInference(req, res, "completions")));
v1Router.post("/embeddings", requireApiKey, asyncHandler((req, res) => handleInference(req, res, "embeddings")));

v1Router.use(openAiErrorHandler);
