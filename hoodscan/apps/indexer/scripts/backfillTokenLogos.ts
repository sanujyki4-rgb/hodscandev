import { prisma } from "@hoodscan/database";
import { fetchTokenLogoUrl } from "../src/services/tokenLogoResolver";

/**
 * One-shot / resumable backfill of Token.logoUrl from Blockscout.
 *
 * The lazy metadata resolver only revisits tokens missing name/symbol, so the
 * ~10k tokens already resolved would never pick up a logo without this pass.
 * Here we walk every token whose logoUrl is still NULL (unchecked), most-active
 * first, and fetch its Blockscout icon — throttled to protect the explorer.
 *
 * RESUMABLE & IDEMPOTENT:
 *   - Only rows with logoUrl IS NULL are processed. Successfully checked rows
 *     become either a URL or "" (checked, no icon) and are skipped next time.
 *   - Transient failures leave the row NULL, so a later re-run retries them.
 *
 * Run (drains the whole backlog, ~150ms/token):
 *   pnpm --filter @hoodscan/indexer backfill:tokenlogos
 *
 * Options (env):
 *   LOGO_DELAY_MS  delay between tokens (default 150)
 *   LOGO_MAX       max tokens to process this run (default: all pending)
 */
const DELAY_MS = Number(process.env.LOGO_DELAY_MS ?? 150);
const MAX = process.env.LOGO_MAX ? Number(process.env.LOGO_MAX) : Infinity;
const BATCH = 200;

async function main(): Promise<void> {
  const t0 = Date.now();
  let processed = 0;
  let withLogo = 0;
  let noLogo = 0;
  let retryLater = 0;

  const pendingTotal = await prisma.token.count({ where: { logoUrl: null } });
  console.log(
    `[logos] Pending (logoUrl IS NULL): ${pendingTotal}. delay=${DELAY_MS}ms max=${MAX}`
  );

  while (processed < MAX) {
    const rows = await prisma.token.findMany({
      where: { logoUrl: null },
      orderBy: { transferCount: "desc" },
      take: Math.min(BATCH, MAX - processed),
      select: { address: true, symbol: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const result = await fetchTokenLogoUrl(row.address);

      if (result === null) {
        // transient — leave NULL, will retry on a later run
        retryLater++;
      } else {
        await prisma.token.update({
          where: { address: row.address },
          data: { logoUrl: result },
        });
        if (result) {
          withLogo++;
          console.log(`[logos]   + ${row.symbol ?? row.address} -> ${result}`);
        } else {
          noLogo++;
        }
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(
          `[logos] processed=${processed} withLogo=${withLogo} noLogo=${noLogo} retryLater=${retryLater}`
        );
      }
      if (DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  }

  console.log(
    `[logos] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `processed=${processed} withLogo=${withLogo} noLogo=${noLogo} retryLater=${retryLater}`
  );
  if (retryLater > 0) {
    console.log(`[logos] ${retryLater} left NULL (transient) — re-run to retry.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[logos] Fatal:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
