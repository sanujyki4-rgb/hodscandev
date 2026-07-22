import { prisma } from "@hoodscan/database";

/**
 * One-shot recompute of Token aggregates + TokenBalance from the authoritative
 * TokenTransfer table. Pure set-based SQL, ORDER-INDEPENDENT — so it produces
 * correct balances / holderCount / transferCount even after a REVERSE backfill,
 * where the live incremental balance guard intentionally skips out-of-order
 * (older) blocks.
 *
 * Safe to re-run anytime (idempotent): every value is derived fresh from
 * TokenTransfer, never incremented.
 *
 * Run:  pnpm backfill:recompute        (from repo root or apps/indexer)
 */

const ZERO = "0x0000000000000000000000000000000000000000";

async function main(): Promise<void> {
  const t0 = Date.now();

  console.log(
    "[recompute] 1/4 Token aggregates (transferCount, firstSeenBlock)…"
  );
  const tokens = await prisma.$executeRawUnsafe(`
    INSERT INTO "Token" ("address", "tokenType", "firstSeenBlock", "transferCount", "updatedAt")
    SELECT "tokenAddress", 'erc20', MIN("blockNumber"), COUNT(*)::int, now()
    FROM "TokenTransfer"
    GROUP BY "tokenAddress"
    ON CONFLICT ("address") DO UPDATE
      SET "transferCount" = EXCLUDED."transferCount",
          "firstSeenBlock" = LEAST(
            COALESCE("Token"."firstSeenBlock", EXCLUDED."firstSeenBlock"),
            EXCLUDED."firstSeenBlock"
          ),
          "updatedAt" = now()
  `);
  console.log(`[recompute]   -> ${tokens} token row(s) upserted.`);

  console.log("[recompute] 2/4 TokenBalance (net balance per owner)…");
  const balances = await prisma.$executeRawUnsafe(`
    INSERT INTO "TokenBalance" ("tokenAddress", "ownerAddress", "balance", "updatedBlock")
    SELECT token, owner, bal, maxblk FROM (
      SELECT "tokenAddress" AS token, addr AS owner,
             SUM(delta) AS bal, MAX(blk) AS maxblk
      FROM (
        SELECT "tokenAddress", "toAddress"  AS addr, "amount"       AS delta, "blockNumber" AS blk FROM "TokenTransfer"
        UNION ALL
        SELECT "tokenAddress", "fromAddress" AS addr, (0 - "amount") AS delta, "blockNumber" AS blk FROM "TokenTransfer"
      ) moves
      WHERE addr <> '${ZERO}'
      GROUP BY "tokenAddress", addr
    ) agg
    ON CONFLICT ("tokenAddress", "ownerAddress") DO UPDATE
      SET "balance" = EXCLUDED."balance",
          "updatedBlock" = EXCLUDED."updatedBlock"
  `);
  console.log(`[recompute]   -> ${balances} balance row(s) upserted.`);

  console.log("[recompute] 3/4 Reset holderCount to 0…");
  await prisma.$executeRawUnsafe(`UPDATE "Token" SET "holderCount" = 0`);

  console.log("[recompute] 4/4 Recount holders (balance > 0)…");
  const holders = await prisma.$executeRawUnsafe(`
    UPDATE "Token" t
    SET "holderCount" = sub.cnt, "updatedAt" = now()
    FROM (
      SELECT "tokenAddress", COUNT(*)::int AS cnt
      FROM "TokenBalance"
      WHERE "balance" > 0 AND "ownerAddress" <> '${ZERO}'
      GROUP BY "tokenAddress"
    ) sub
    WHERE t."address" = sub."tokenAddress"
  `);
  console.log(`[recompute]   -> holderCount set for ${holders} token(s).`);

  console.log(
    `[recompute] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[recompute] Fatal:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
