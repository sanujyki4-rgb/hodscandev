/**
 * One-off verification script — NOT part of the running indexer.
 * Confirms watchL1Messages() correctly links a KNOWN real L1->L2
 * message before trusting it to run unattended on live traffic.
 *
 * Test case (found via Blockscout's official Robinhood Chain explorer):
 *   L1 tx:    0xb7a8d59d0df46a2ab09f59c0a3d7ff120bdb2f0ba5c5cd8d2e5f3b3bed6f9c07
 *   L1 block: 25529111
 *   L2 tx:    0x6be39ba6405427c728b6da58ad5b37655637374d9f39976b87b122bf83d5e713
 *
 * Run from apps/indexer:
 *   pnpm exec dotenv -e ../../.env -- tsx scripts/testWatchL1Message.ts
 * (or add a "test:l1" script to package.json that wraps this)
 *
 * Delete this file once watchL1Messages is trusted to run unattended.
 */
import { prisma } from "@hoodscan/database";
import { watchL1Messages } from "../src/jobs/watchL1Messages";

const KNOWN_L1_BLOCK = 25529111n;
const EXPECTED_L1_TX = "0xb7a8d59d0df46a2ab09f59c0a3d7ff120bdb2f0ba5c5cd8d2e5f3b3bed6f9c07";
const EXPECTED_L2_TX = "0x6be39ba6405427c728b6da58ad5b37655637374d9f39976b87b122bf83d5e713";

async function main() {
  console.log(`[test] Scanning only L1 block ${KNOWN_L1_BLOCK}...`);
  await watchL1Messages({ fromBlock: KNOWN_L1_BLOCK, toBlock: KNOWN_L1_BLOCK });

  const rows = await prisma.l1ToL2Message.findMany({
    where: { originBlockNumber: KNOWN_L1_BLOCK },
  });

  console.log(`[test] Found ${rows.length} L1ToL2Message row(s) at that block:`);
  for (const row of rows) {
    console.log({
      id: row.id.toString(),
      requestId: row.requestId,
      originTxHash: row.originTxHash,
      l2TxHash: row.l2TxHash,
      status: row.status,
    });
  }

  const match = rows.find(
    (r) => r.originTxHash.toLowerCase() === EXPECTED_L1_TX.toLowerCase()
  );

  if (!match) {
    console.error(`[test] FAIL — no row found with originTxHash === ${EXPECTED_L1_TX}`);
    console.error(
      "[test] Either the Bridge ABI/event filter isn't matching, or this L1 tx " +
        "didn't actually produce a MessageDelivered event in this block range."
    );
  } else if (match.l2TxHash?.toLowerCase() !== EXPECTED_L2_TX.toLowerCase()) {
    console.error(
      `[test] PARTIAL — L1 side matched, but l2TxHash is "${match.l2TxHash}", ` +
        `expected "${EXPECTED_L2_TX}".`
    );
    console.error(
      "[test] This means the requestId/retryableCreationId computed by the SDK " +
        "does NOT equal the L2 tx hash for this case — the 'ticketId === L2 hash' " +
        "assumption in l1MessageService.ts needs revisiting."
    );
  } else {
    console.log("[test] PASS — L1 tx and L2 tx both matched correctly.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[test] Fatal error:", err);
  process.exit(1);
});
