import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { getAddressLabel } from "@hoodscan/types";
import { resolveContractInfo } from "../utils/contractNames";
import { isValidAddress } from "../utils/address";
import { rpcClient } from "../utils/rpcClient";

/**
 * GET /address/:address
 * Address header/overview: native (gas-token) balance, account nonce, total
 * transaction count, contract/token flags, and label. Powers the "Balance"
 * summary at the top of an address page.
 *
 * On-chain reads (balance/nonce) are best-effort: a slow/unavailable RPC
 * yields null rather than failing the whole response. Cached briefly upstream.
 */
export async function getAddressOverview(req: Request, res: Response) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const addr = address as `0x${string}`;

  const [nativeBalance, nonce, txCount, nftRow, info] = await Promise.all([
    // Native balance (wei) via RPC — best-effort.
    rpcClient.getBalance({ address: addr }).catch(() => null),
    // Account nonce (number of sent txns) via RPC — best-effort.
    rpcClient.getTransactionCount({ address: addr }).catch(() => null),
    // Total txns where the address is sender OR receiver (from the index).
    prisma.transaction.count({
      where: { OR: [{ fromAddress: address }, { toAddress: address }] },
    }),
    // Cheap existence check for the conditional "NFT Transfers" tab.
    prisma.nftTransfer.findFirst({
      where: { OR: [{ fromAddress: address }, { toAddress: address }] },
      select: { id: true },
    }),
    // Shared resolver: contract/token flags (+ cached names), Etherscan-style.
    resolveContractInfo([address]),
  ]);

  res.json(
    serializeBigInt({
      address,
      label: getAddressLabel(address),
      isContract: info.isContract.get(address) ?? null,
      isToken: info.isToken.get(address) ?? false,
      nativeBalance,
      nonce,
      txCount,
      hasNftActivity: !!nftRow,
    })
  );
}
