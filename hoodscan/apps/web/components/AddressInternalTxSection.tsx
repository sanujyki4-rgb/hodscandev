import { getAddressInternalTransactions } from "@/lib/api";
import { AddressInternalTxTable } from "@/components/AddressInternalTxTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Server component for the address page's "Internal Txns" tab. Fetches the
 * paginated internal transactions (from the indexer's InternalTransaction
 * table) for the address and renders the table plus pagination. The active tab
 * is tracked via the URL hash (#internaltx). Historical rows fill in as the
 * indexer traces older blocks, so an empty result is a "not indexed yet" state.
 */
export async function AddressInternalTxSection({
  address,
  page,
  pageParam = "page",
  hashSuffix = "",
}: {
  address: string;
  page: number;
  pageParam?: string;
  hashSuffix?: string;
}) {
  const offset = (page - 1) * LIMIT;
  const data = await getAddressInternalTransactions(address, LIMIT, offset);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <ResultCount total={total} noun="internal transaction" />
      <AddressInternalTxTable rows={data?.internalTransactions ?? []} />
      {total > 0 && (
        <Pagination
          basePath={`/address/${address}`}
          page={page}
          limit={LIMIT}
          total={total}
          noun="internal transactions"
          pageParam={pageParam}
          hashSuffix={hashSuffix}
        />
      )}
    </div>
  );
}
