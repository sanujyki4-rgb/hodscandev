import { prisma } from "@hoodscan/database";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";

/**
 * Bounded row count for list endpoints. Counts AT MOST EXPLORER_LIST_CAP
 * rows via a `LIMIT`ed subquery, so a huge, constantly-growing table
 * never triggers an expensive full-table `count(*)` scan (the cause of
 * the ~30s /transactions?offset= response). Mirrors Etherscan's
 * "Showing the last 500k records" cap.
 *
 * `table` MUST be a trusted literal (a Prisma model's Postgres table
 * name), never user input — it is interpolated directly into SQL.
 */
export async function cappedCount(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM (SELECT 1 FROM "${table}" LIMIT ${EXPLORER_LIST_CAP}) t`
  );
  return Number(rows[0]?.count ?? 0);
}
