import { TxTable } from "@/components/TxTable";
import { Pagination } from "@/components/Pagination";
import { getPaginatedTransactions } from "@/lib/api";

export const revalidate = 2;

const LIMIT = 25;

export default async function AllTransactionsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(Number(searchParams.page) || 1, 1);
  const offset = (page - 1) * LIMIT;

  const data = await getPaginatedTransactions(LIMIT, offset);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        All transactions
      </h1>

      {data === null ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          Couldn&apos;t reach the hoodscan API.
        </p>
      ) : (
        <>
          <TxTable transactions={data.transactions} variant="detailed" />
          <Pagination
            basePath="/transactions"
            page={page}
            limit={data.limit}
            total={data.total}
            noun="transactions"
          />
        </>
      )}
    </div>
  );
}
