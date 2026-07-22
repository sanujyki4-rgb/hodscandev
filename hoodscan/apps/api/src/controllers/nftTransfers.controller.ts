import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { getAddressLabel } from "@hoodscan/types";
import { getTokenMetadata } from "../utils/tokenResolver";
import { resolveContractInfo } from "../utils/contractNames";
import { isValidAddress } from "../utils/address";

/**
 * GET /address/:address/nft-transfers?limit=25&offset=0
 *
 * NFT transfer events (ERC-721 + ERC-1155) where the address is the
 * sender OR receiver, newest first (from the NftTransfer table populated
 * by the indexer). Mirrors listTokenTransfersByAddress, but NFT amounts
 * are NOT scaled by decimals — `amount` is a token count (1 for ERC-721,
 * the transferred quantity for ERC-1155) and `tokenId` identifies the
 * specific token. Collection name/symbol are resolved once per unique
 * contract via Layer 1's tokenResolver (best-effort; may be null).
 */
export async function listNftTransfersByAddress(req: Request, res: Response) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = {
    OR: [{ fromAddress: address }, { toAddress: address }],
  };

  const [transfers, total] = await Promise.all([
    prisma.nftTransfer.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }, { batchIndex: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.nftTransfer.count({ where }),
  ]);

  // Resolve collection metadata once per unique contract in this page.
  const uniqueTokens = [...new Set(transfers.map((t) => t.tokenAddress))];
  const metaEntries = await Promise.all(
    uniqueTokens.map(
      async (addr) => [addr, await getTokenMetadata(addr, true)] as const
    )
  );
  const metaByToken = new Map(metaEntries);

  // Contract icons + verified names for From/To parties (shared helper).
  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: nameByAddr } =
    await resolveContractInfo(transfers.flatMap((t) => [t.fromAddress, t.toAddress]));

  const rows = transfers.map((t) => {
    const meta = metaByToken.get(t.tokenAddress) ?? null;
    return {
      txHash: t.txHash,
      logIndex: t.logIndex,
      batchIndex: t.batchIndex,
      blockNumber: t.blockNumber,
      timestamp: t.timestamp,
      tokenAddress: t.tokenAddress,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      tokenId: t.tokenId,
      amount: t.amount,
      standard: t.standard,
      tokenName: meta?.name ?? null,
      tokenSymbol: meta?.symbol ?? null,
      direction:
        t.fromAddress === address
          ? "out"
          : t.toAddress === address
            ? "in"
            : null,
      fromLabel: getAddressLabel(t.fromAddress) ?? nameByAddr.get(t.fromAddress) ?? null,
      toLabel: getAddressLabel(t.toAddress) ?? nameByAddr.get(t.toAddress) ?? null,
      fromIsContract: isContractByAddr.get(t.fromAddress) ?? null,
      fromIsToken: isTokenByAddr.get(t.fromAddress) ?? false,
      toIsToken: isTokenByAddr.get(t.toAddress) ?? false,
      toIsContract: isContractByAddr.get(t.toAddress) ?? null,
      tokenIsContract: true,
    };
  });

  res.json(
    serializeBigInt({
      address,
      label: getAddressLabel(address),
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      transfers: rows,
    })
  );
}
