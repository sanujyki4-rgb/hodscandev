import { SearchBar } from "@/components/SearchBar";
import { StatsBar } from "@/components/StatsBar";
import { BlocksTable } from "@/components/BlocksTable";
import { TxTable } from "@/components/TxTable";
import { L1L2Table } from "@/components/L1L2Table";
import { BlockIcon, TxIcon, LayersIcon } from "@/components/icons";
import {
  getLatestBlocks,
  getLatestTransactions,
  getLatestL1ToL2Transactions,
  getPaginatedBlocks,
  getPaginatedTransactions,
} from "@/lib/api";

export const revalidate = 2;

export default async function HomePage() {
  const [statsBlocks, transactions, l1ToL2Transactions, blocksPage, txsPage] = await Promise.all([
    getLatestBlocks(50),
    getLatestTransactions(7),
    getLatestL1ToL2Transactions(7),
    getPaginatedBlocks(1, 0),
    getPaginatedTransactions(1, 0),
  ]);

  // Table only needs the 7 most recent — statsBlocks is fetched larger
  // (50) purely so StatsBar can compute an accurate avg block time.
  const blocks = statsBlocks?.slice(0, 7) ?? null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 py-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            The Robinhood Chain Explorer
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Look up blocks, transactions, and addresses.
          </p>
        </div>
        <div className="w-full max-w-xl">
          <SearchBar />
        </div>
      </div>

      {statsBlocks && statsBlocks.length > 0 && (
        <StatsBar
          blocks={statsBlocks}
          totalBlocks={blocksPage?.total ?? null}
          totalTransactions={txsPage?.total ?? null}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted">
            <BlockIcon size={24} className="text-lime" />
            Latest blocks
          </h2>
          {blocks === null ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
              Couldn&apos;t reach the hoodscan API. Is the indexer running?
            </p>
          ) : (
            <BlocksTable blocks={blocks} viewAllHref="/blocks" />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted">
            <TxIcon size={24} className="text-lime" />
            Latest transactions
          </h2>
          {transactions === null ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
              Couldn&apos;t reach the hoodscan API.
            </p>
          ) : (
            <TxTable transactions={transactions} showAge showType={false} viewAllHref="/transactions" />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted">
            <LayersIcon size={24} className="text-lime" />
            Latest L1↔L2 messages
          </h2>
          {l1ToL2Transactions === null ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
              Couldn&apos;t reach the hoodscan API.
            </p>
          ) : (
            <L1L2Table messages={l1ToL2Transactions} viewAllHref="/transactions/l1-to-l2" />
          )}
        </div>
      </div>
    </div>
  );
}
