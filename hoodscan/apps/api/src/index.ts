import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { describeL2RpcEndpoints, L2_RPC_URLS } from "@hoodscan/rpc";
import blocksRouter from "./routes/blocks.route";
import transactionsRouter from "./routes/transactions.route";
import addressRouter from "./routes/address.route";
import tokensRouter from "./routes/tokens.route";
import statsRouter from "./routes/stats.route";
import { errorHandler } from "./middlewares/errorHandler";

const app = express();
const PORT = Number(process.env.API_PORT) || 4000;

// Restrict CORS to the frontend origin(s). CORS_ORIGIN may be a
// comma-separated list; defaults to the local Next.js dev server.
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Health check is registered BEFORE the rate limiter so uptime
// probes are never throttled.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Global rate limiter: 120 requests per minute per IP. Protects the
// public explorer endpoints from scraping/abuse.
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use("/blocks", blocksRouter);
app.use("/transactions", transactionsRouter);
app.use("/address", addressRouter);
app.use("/tokens", tokensRouter);
app.use("/stats", statsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler — must be the LAST middleware.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[api] hoodscan API listening on http://localhost:${PORT}`);
  console.log(
    `[api] L2 RPC endpoints (${L2_RPC_URLS.length}): ${describeL2RpcEndpoints()}`
  );
});
