import path from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { accountRouter } from "./routes/account";
import { adminRouter } from "./routes/admin";
import { paymentsRouter } from "./routes/payments";
import { v1Router } from "./routes/v1";

const app = express();

app.use(cors());
// OpenAI-compatible API — ahead of the app-wide JSON parser, since it
// brings its own with a larger body limit.
app.use("/v1", v1Router);
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/admin", adminRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api", accountRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`LLM router listening on port ${config.port}`);
});
