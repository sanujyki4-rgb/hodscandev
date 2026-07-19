import { Router } from "express";
import { listTransactionsByAddress } from "../controllers/address.controller";
import { listTokenTransfersByAddress } from "../controllers/tokenTransfers.controller";
import { listNftTransfersByAddress } from "../controllers/nftTransfers.controller";
import { getAddressContract } from "../controllers/contract.controller";
import { getReadContract, callReadContract } from "../controllers/readContract.controller";
import { getVerification, postVerify } from "../controllers/verifyContract.controller";
import { cacheMiddleware } from "../middlewares/cache";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.get("/:address/transactions", cacheMiddleware(5), asyncHandler(listTransactionsByAddress));
router.get("/:address/token-transfers", cacheMiddleware(5), asyncHandler(listTokenTransfersByAddress));
router.get("/:address/nft-transfers", cacheMiddleware(5), asyncHandler(listNftTransfersByAddress));
router.get("/:address/contract", cacheMiddleware(300), asyncHandler(getAddressContract));
// Read Contract (Phase 1): list detected read fns + eager zero-arg values.
router.get("/:address/read-contract", cacheMiddleware(30), asyncHandler(getReadContract));
// On-demand execution of a single read fn with user args (not cached).
router.post("/:address/read-contract", asyncHandler(callReadContract));
// Source-code verification: status (verified source + ABI) and submit.
router.get("/:address/verification", cacheMiddleware(30), asyncHandler(getVerification));
router.post("/:address/verify", asyncHandler(postVerify));

export default router;
