import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { getAddressLabel } from "@hoodscan/types";
import { getTokenMetadata } from "../utils/tokenResolver";
import { formatTokenAmount, decimalToBigInt } from "../utils/formatToken";
import { resolveContractInfo } from "../utils/contractNames";
import { isValidAddress } from "../utils/address";

/**
 * GET /address/:address/token-transfers?limit=25&offset=0
 *
 * ERC-20 Transfer events where the address is the sender OR receiver,
 * newest first (from the TokenTransfer table populated by the indexer).
 * Each row's amount is scaled by the token's on-chain decimals —
 * resolved once per unique token in the page via Layer 1's tokenResolver
 * (the user's own RPC node + Redis cache) — and tagged IN/OUT relative
 * to the queried address.
 */
export async function listTokenTransfersByAddress(req: Request, res: Response) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = {
    OR: [{ fromAddress: address }, { toAddress: address }],
  };

  const [transfers, total] = await Promise.all([
    prisma.tokenTransfer.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.tokenTransfer.count({ where }),
  ]);

  // Resolve token metadata once per unique token in this page (bounded
  // by the page size), so 25 rows of the same token cost a single read.
  const uniqueTokens = [...new Set(transfers.map((t) => t.tokenAddress))];
  const metaEntries = await Promise.all(
    uniqueTokens.map(
      async (addr) => [addr, await getTokenMetadata(addr, true)] as const
    )
  );
  const metaByToken = new Map(metaEntries);

  // Contract icons + verified names for From/To parties (shared helper).
  const { isContract: isContractByAddr, names: nameByAddr } =
    await resolveContractInfo(transfers.flatMap((t) => [t.fromAddress, t.toAddress]));

  const rows = transfers.map((t) => {
    const meta = metaByToken.get(t.tokenAddress) ?? null;
    const decimals = meta?.decimals ?? null;
    const raw = decimalToBigInt(t.amount);
    return {
      txHash: t.txHash,
      logIndex: t.logIndex,
      blockNumber: t.blockNumber,
      timestamp: t.timestamp,
      tokenAddress: t.tokenAddress,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      rawAmount: raw.toString(),
      amount: formatTokenAmount(raw, decimals),
      symbol: meta?.symbol ?? null,
      name: meta?.name ?? null,
      decimals,
      direction:
        t.fromAddress === address
          ? "out"
          : t.toAddress === address
            ? "in"
            : null,
      fromLabel: getAddressLabel(t.fromAddress) ?? nameByAddr.get(t.fromAddress) ?? null,
      toLabel: getAddressLabel(t.toAddress) ?? nameByAddr.get(t.toAddress) ?? null,
      fromIsContract: isContractByAddr.get(t.fromAddress) ?? null,
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
