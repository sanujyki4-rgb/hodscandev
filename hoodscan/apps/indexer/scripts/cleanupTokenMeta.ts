import { prisma } from "@hoodscan/database";

/**
 * One-shot cleanup for Token rows whose name/symbol were persisted BEFORE the
 * clampTokenMeta() guard was added (see tokenMetadataResolver.ts). Some junk
 * tokens on-chain report multi-KB name/symbol values or embed NUL bytes, which:
 *   - blow past the Token.symbol B-tree index limit (~8191 bytes) → error 54000
 *   - cannot be stored in Postgres text columns (NUL bytes)
 *
 * This script finds those already-bad rows and repairs them IN PLACE using the
 * exact same clamp rules the resolver now applies on write:
 *   name   → max 256 chars, symbol → max 128 chars, NUL stripped, trimmed,
 *   empty → NULL.
 *
 * SAFE BY DESIGN:
 *   - DRY-RUN by default: only reports what WOULD change, writes nothing.
 *   - Pass --apply to actually persist the fixes.
 *   - Idempotent: safe to re-run; already-clean rows are skipped.
 *   - No schema migration, no DB reset, no data deletion — only clamps 2 columns.
 *
 * Run (dry-run, shows what would change):
 *   pnpm --filter @hoodscan/indexer cleanup:tokenmeta
 *   # or, from apps/indexer:  pnpm cleanup:tokenmeta
 *
 * Run for real (writes the fixes):
 *   pnpm --filter @hoodscan/indexer cleanup:tokenmeta -- --apply
 */

// Must match the limits used in tokenMetadataResolver.ts on write.
const MAX_NAME = 256;
const MAX_SYMBOL = 128;

/**
 * Identical logic to clampTokenMeta() in the resolver: strip NUL bytes, trim,
 * null out empties, and cap length. Kept in sync intentionally.
 */
function clampTokenMeta(value: string | null, maxLen: number): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/\u0000/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

interface BadTokenRow {
  address: string;
  name: string | null;
  symbol: string | null;
}

function preview(value: string | null): string {
  if (value == null) return "NULL";
  const shown = value.replace(/\u0000/g, "\\0").slice(0, 40);
  const suffix = value.length > 40 ? `… (${value.length} chars)` : "";
  return JSON.stringify(shown) + suffix;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const t0 = Date.now();

  console.log(
    `[cleanup-tokenmeta] Mode: ${apply ? "APPLY (will write)" : "DRY-RUN (no writes)"}`
  );

  // Only pull the small set of rows that are actually problematic:
  //   - name longer than the cap
  //   - symbol longer than the cap
  // char_length counts characters (matches JS .length closely enough for the
  // ASCII/UTF-8 junk these tokens contain). We still re-check in JS below.
  const candidates = await prisma.$queryRawUnsafe<BadTokenRow[]>(`
    SELECT "address", "name", "symbol"
    FROM "Token"
    WHERE char_length(COALESCE("name", ''))   > ${MAX_NAME}
       OR char_length(COALESCE("symbol", '')) > ${MAX_SYMBOL}
  `);

  console.log(
    `[cleanup-tokenmeta] Found ${candidates.length} candidate row(s) to inspect.`
  );

  let fixed = 0;
  for (const row of candidates) {
    const newName = clampTokenMeta(row.name, MAX_NAME);
    const newSymbol = clampTokenMeta(row.symbol, MAX_SYMBOL);

    const nameChanged = newName !== row.name;
    const symbolChanged = newSymbol !== row.symbol;
    if (!nameChanged && !symbolChanged) continue; // already clean

    fixed++;
    console.log(`\n[cleanup-tokenmeta] ${row.address}`);
    if (nameChanged) {
      console.log(`    name  : ${preview(row.name)}  ->  ${preview(newName)}`);
    }
    if (symbolChanged) {
      console.log(`    symbol: ${preview(row.symbol)}  ->  ${preview(newSymbol)}`);
    }

    if (apply) {
      await prisma.token.update({
        where: { address: row.address },
        data: {
          ...(nameChanged ? { name: newName } : {}),
          ...(symbolChanged ? { symbol: newSymbol } : {}),
        },
      });
    }
  }

  console.log(
    `\n[cleanup-tokenmeta] ${apply ? "Repaired" : "Would repair"} ${fixed} row(s).`
  );
  if (!apply && fixed > 0) {
    console.log(
      "[cleanup-tokenmeta] Re-run with `-- --apply` to persist these fixes."
    );
  }
  console.log(
    `[cleanup-tokenmeta] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[cleanup-tokenmeta] Fatal:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
