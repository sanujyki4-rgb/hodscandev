/**
 * Dev harness: exercises the token-metadata backoff scheduler WITHOUT any real
 * provider or database. It reuses the exact pure decision functions the indexer
 * loop uses (from src/services/metadataBackoff), and drives them with a fake
 * sequence of pass outcomes so you can watch the backoff level rise while the
 * "provider" is failing, then recover the moment it succeeds again.
 *
 * Run:  pnpm --filter @hoodscan/indexer test:backoff
 *   or: pnpm test:backoff   (from apps/indexer)
 *
 * Nothing here touches the network or DB — it's purely the scheduling math.
 */
import {
  tokenMetadataPlan,
  applyMetadataBackoff,
  nextMetadataBackoffLevel,
  TOKEN_METADATA_BUSY_INTERVAL_MS,
  type MetadataPassOutcome,
} from "../src/services/metadataBackoff";

/** A scripted pass: what the (fake) resolver "returned" this round. */
interface ScriptedPass {
  label: string;
  backlog: number;
  outcome: MetadataPassOutcome;
}

// Simulate a busy backlog whose provider fails 4 passes in a row (resolves
// nothing / throws), then heals — so we see the level climb 1→2→3→4 then reset.
const SCRIPT: ScriptedPass[] = [
  { label: "healthy", backlog: 800, outcome: { processed: 100, resolved: 92 } },
  { label: "provider degraded (0 resolved)", backlog: 800, outcome: { processed: 100, resolved: 0 } },
  { label: "still failing (0 resolved)", backlog: 800, outcome: { processed: 100, resolved: 0 } },
  { label: "pass threw", backlog: 800, outcome: { processed: 0, resolved: 0, threw: true } },
  { label: "still failing (0 resolved)", backlog: 800, outcome: { processed: 100, resolved: 0 } },
  { label: "RECOVERED (some resolved)", backlog: 800, outcome: { processed: 100, resolved: 40 } },
  { label: "healthy", backlog: 300, outcome: { processed: 50, resolved: 48 } },
  { label: "backlog drained (idle)", backlog: 0, outcome: { processed: 0, resolved: 0 } },
];

function fmtSecs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function main() {
  console.log("=== token-metadata backoff simulation (no provider/DB) ===\n");
  let level = 0;

  console.log(
    "pass | scenario                        | backlog | processed/resolved | level | next delay"
  );
  console.log(
    "-----+---------------------------------+---------+--------------------+-------+-----------"
  );

  SCRIPT.forEach((pass, i) => {
    const { intervalMs } = tokenMetadataPlan(pass.backlog);

    // Idle (empty) passes never touch backoff in the loop; mirror that here.
    if (pass.backlog === 0) {
      level = 0;
    } else {
      level = nextMetadataBackoffLevel(level, pass.outcome);
    }

    const baseForDelay =
      pass.outcome.threw && pass.backlog > 0
        ? TOKEN_METADATA_BUSY_INTERVAL_MS
        : intervalMs;
    const nextDelayMs = applyMetadataBackoff(baseForDelay, level);

    const pr = `${pass.outcome.resolved}/${pass.outcome.processed}${
      pass.outcome.threw ? " (threw)" : ""
    }`;

    console.log(
      `  ${String(i + 1).padStart(2)} | ${pass.label.padEnd(31)} | ${String(
        pass.backlog
      ).padStart(7)} | ${pr.padEnd(18)} | ${
        level > 0 ? `L${level}` : "0 "
      }    | ${fmtSecs(nextDelayMs)}`
    );
  });

  console.log(
    "\nExpectation: level climbs 1→2→3→4 while the provider is failing, then"
  );
  console.log(
    "jumps back to 0 on the RECOVERED pass and returns to the normal cadence."
  );
  console.log(
    "Note: a \"0 resolved\" pass uses the backlog base (5s here) so its delay"
  );
  console.log(
    "doubles 5s→10s→20s→...; a pass that THREW instead uses the BUSY base (15s),"
  );
  console.log(
    "so pass 4 shows 15s×2^3 = 120s — different base, same backoff mechanism."
  );
}

main();
