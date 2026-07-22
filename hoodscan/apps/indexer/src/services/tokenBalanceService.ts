import { prisma } from "@hoodscan/database";
import type { TokenTransferRow } from "./tokenTransferService";

/**
 * Layer 3 — maintain live TokenBalance + Token aggregates from the SAME
 * ERC-20 Transfer rows the indexer already extracted from block receipts
 * (see tokenTransferService.extractTokenTransfers). There are NO extra RPC
 * calls here: everything is derived from the transfer rows in hand.
 *
 *  - TokenBalance: net per-owner delta (to += amount, from -= amount).
 *  - Token: one row per token contract, with a running transferCount and a
 *    firstSeenBlock. name/symbol/decimals/totalSupply are resolved LAZILY,
 *    off the hot path, by tokenMetadataResolver.ts (never here — that needs
 *    RPC). holderCount is likewise recomputed lazily (see recountTokenHolders).
 */

/** Zero address — never gets a TokenBalance row (mint source / burn sink). */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Apply the balance + token-aggregate side effects of a batch of ERC-20
 * transfer rows for a single block.
 *
 * IDEMPOTENCY (important): incrementing a balance is NOT naturally idempotent —
 * re-processing the same block would double-count. We guard against that with a
 * raw `ON CONFLICT ... WHERE "TokenBalance"."updatedBlock" < EXCLUDED."updatedBlock"`
 * clause: the increment is only applied when the incoming block is strictly
 * newer than the row's last-touched block, so replaying a block (or an older
 * block after a newer one) is a no-op. New rows are always created.
 *
 * NOTE: because the whole batch shares one `blockNumber`, the guard is
 * per-block, not per-transfer. Multiple transfers of the same token/owner
 * within THIS block are pre-aggregated below before the single upsert, so the
 * net delta for the block is applied exactly once.
 *
 * @param rows   ERC-20 transfer rows (already extracted from receipts, no RPC)
 * @param blockNumber the block these rows belong to
 */
export async function applyTokenBalanceUpdates(
  rows: TokenTransferRow[],
  blockNumber: bigint
): Promise<void> {
  if (rows.length === 0) return;

  // 1) Net balance deltas per (tokenAddress, ownerAddress). Skip the zero
  //    address (mint source / burn sink) — it never holds a real balance.
  const deltas = new Map<string, bigint>(); // key: `${token}\n${owner}` -> delta
  // 2) Per-token transfer counts + earliest block seen, for the Token table.
  const tokenCounts = new Map<string, number>();

  const bump = (token: string, owner: string, delta: bigint) => {
    if (owner === ZERO_ADDRESS) return;
    const key = `${token}\n${owner}`;
    deltas.set(key, (deltas.get(key) ?? 0n) + delta);
  };

  for (const row of rows) {
    const token = row.tokenAddress;
    let amount: bigint;
    try {
      amount = BigInt(row.amount);
    } catch {
      continue; // malformed amount — skip, never throw
    }

    bump(token, row.toAddress, amount);
    bump(token, row.fromAddress, -amount);

    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }

  // --- Persist Token aggregates (create or bump transferCount) -------------
  // holderCount is intentionally left to recountTokenHolders (lazy); we never
  // try to keep it perfectly live here because it requires reading balances.
  const tokenOps = [...tokenCounts.entries()].map(([tokenAddress, count]) =>
    prisma.token.upsert({
      where: { address: tokenAddress },
      create: {
        address: tokenAddress,
        tokenType: "erc20",
        firstSeenBlock: blockNumber,
        transferCount: count,
      },
      update: {
        transferCount: { increment: count },
      },
    })
  );

  // --- Persist TokenBalance deltas via guarded raw upsert ------------------
  // Raw SQL ON CONFLICT lets us apply "balance = balance + delta" atomically
  // while the WHERE guard blocks double-counting on block replay.
  const balanceOps = [...deltas.entries()].map(([key, delta]) => {
    const [tokenAddress, ownerAddress] = key.split("\n");
    const deltaStr = delta.toString();
    return prisma.$executeRaw`
      INSERT INTO "TokenBalance" ("tokenAddress", "ownerAddress", "balance", "updatedBlock")
      VALUES (${tokenAddress}, ${ownerAddress}, ${deltaStr}::numeric, ${blockNumber})
      ON CONFLICT ("tokenAddress", "ownerAddress") DO UPDATE
        SET "balance" = "TokenBalance"."balance" + EXCLUDED."balance",
            "updatedBlock" = EXCLUDED."updatedBlock"
        WHERE "TokenBalance"."updatedBlock" < EXCLUDED."updatedBlock"
    `;
  });

  // One transaction so a block's aggregates land atomically (all-or-nothing).
  await prisma.$transaction([...tokenOps, ...balanceOps]);
}

/**
 * Recompute Token.holderCount for a single token: the number of TokenBalance
 * rows for that token with a positive balance (excluding the zero address).
 *
 * This is deliberately NOT maintained inline in applyTokenBalanceUpdates —
 * doing so would require reading every affected owner's post-update balance on
 * the hot path. Instead this is callable on demand (e.g. from the metadata
 * resolver job, or a periodic recount) so the block-processing path stays cheap.
 */
export async function recountTokenHolders(tokenAddress: string): Promise<void> {
  const token = tokenAddress.toLowerCase();
  const holderCount = await prisma.tokenBalance.count({
    where: {
      tokenAddress: token,
      balance: { gt: 0 },
      ownerAddress: { not: ZERO_ADDRESS },
    },
  });

  await prisma.token.updateMany({
    where: { address: token },
    data: { holderCount },
  });
}
