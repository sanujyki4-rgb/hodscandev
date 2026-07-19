import { prisma } from "@hoodscan/database";
import { RECEIPT_BACKFILL_DELAY_MS } from "@hoodscan/config";
import { getBlockReceipts } from "../src/rpc/client";
import {
  extractNftTransfers,
  saveNftTransfers,
} from "../src/services/nftTransferService";

/**
 * One-shot NFT backfill: re-scans already-indexed blocks and extracts
 * ERC-721 / ERC-1155 transfers from their receipts into the NftTransfer
 * table. Needed because nftTransferService only runs on NEW blocks going
 * forward — historical NFT transfers (indexed before the feature existed)
 * are otherwise missing.
 *
 * Reuses the exact same receipt source (eth_getBlockReceipts) and decode
 * path as the live indexer, so results are identical. Idempotent: rows are
 * inserted with skipDuplicates on (txHash, logIndex, batchIndex), so
 * re-running never double-inserts and is safe to resume.
 *
 * Throttled one block at a time (RECEIPT_BACKFILL_DELAY_MS) to respect the
 * rate-limited public RPC — mirrors jobs/backfillReceipts.ts.
 *
 * Usage (from apps/indexer):
 *   pnpm backfill:nft                 # scan ALL indexed blocks
 *   pnpm backfill:nft --from=1000     # only blocks >= 1000
 *   pnpm backfill:nft --from=1000 --to=2000
 *   pnpm backfill:nft --batch=250     # DB page size (default 500)
 */
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const fromArg = parseArg("from");
  const toArg = parseArg("to");
  const pageSize = Math.max(1, Number(parseArg("batch") ?? "500"));

  const from = fromArg !== undefined ? BigInt(fromArg) : undefined;
  const to = toArg !== undefined ? BigInt(toArg) : undefined;

  const countWhere: { number?: { gte?: bigint; lte?: bigint } } = {};
  if (from !== undefined || to !== undefined) {
    countWhere.number = {};
    if (from !== undefined) countWhere.number.gte = from;
    if (to !== undefined) countWhere.number.lte = to;
  }

  const totalBlocks = await prisma.block.count({ where: countWhere });
  console.log(
    `[backfillNft] Scanning ${totalBlocks} indexed block(s) for NFT transfers` +
      (from !== undefined ? ` from ${from}` : "") +
      (to !== undefined ? ` to ${to}` : "") +
      "…"
  );

  let processed = 0;
  let savedRows = 0;
  // Cursor over Block.number, ascending. -1n so block 0 is included.
  let lastNumber: bigint = from !== undefined ? from - 1n : -1n;

  while (true) {
    const where: { number: { gt: bigint; lte?: bigint } } = {
      number: { gt: lastNumber },
    };
    if (to !== undefined) where.number.lte = to;

    const blocks = await prisma.block.findMany({
      where,
      select: { number: true, timestamp: true },
      orderBy: { number: "asc" },
      take: pageSize,
    });
    if (blocks.length === 0) break;

    for (const b of blocks) {
      try {
        const hexNumber = "0x" + b.number.toString(16);
        const receipts = await getBlockReceipts(hexNumber);
        const rows = extractNftTransfers(receipts, b.number, b.timestamp);
        const result = await saveNftTransfers(rows);
        savedRows += result.count ?? 0;
      } catch (err) {
        console.error(`[backfillNft] block ${b.number} failed:`, err);
      }
      processed++;
      lastNumber = b.number;
      if (processed % 100 === 0) {
        console.log(
          `[backfillNft] ${processed}/${totalBlocks} blocks · ` +
            `${savedRows} NFT row(s) saved · at block ${lastNumber}`
        );
      }
      // Throttle between blocks to avoid hammering the public RPC.
      await sleep(RECEIPT_BACKFILL_DELAY_MS);
    }
  }

  console.log(
    `[backfillNft] Done. Processed ${processed} block(s), ` +
      `saved ${savedRows} NFT transfer row(s).`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfillNft] Fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
