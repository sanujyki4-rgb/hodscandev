import { Router } from "express";
import { getDailyStats } from "../controllers/stats.controller";
import { cacheMiddleware } from "../middlewares/cache";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

// Daily aggregations only shift once new blocks roll a fresh calendar
// day (and slightly as today's bucket fills), so a 60s cache is plenty
// and keeps the grouped scan off the hot path.
router.get("/daily", cacheMiddleware(60), asyncHandler(getDailyStats));

export default router;
