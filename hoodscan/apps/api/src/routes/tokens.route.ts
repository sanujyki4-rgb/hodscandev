import { Router } from "express";
import {
  listTokens,
  getTokenDetail,
  listTokenTransfers,
  listTokenHolders,
} from "../controllers/tokens.controller";
import { getTokenDaily } from "../controllers/tokenAnalytics.controller";
import { cacheMiddleware } from "../middlewares/cache";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.get("/", cacheMiddleware(10), asyncHandler(listTokens));
router.get("/:address", cacheMiddleware(10), asyncHandler(getTokenDetail));
router.get("/:address/transfers", cacheMiddleware(5), asyncHandler(listTokenTransfers));
router.get("/:address/holders", cacheMiddleware(10), asyncHandler(listTokenHolders));
router.get("/:address/daily", cacheMiddleware(60), asyncHandler(getTokenDaily));

export default router;
