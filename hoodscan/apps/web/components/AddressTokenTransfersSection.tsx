import { getTokenTransfersByAddress } from "@/lib/api";
import { AddressTokenTransfersTable } from "@/components/AddressTokenTransfersTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Server component for the address page's "Token Transfers (ERC-20)"
 * tab. Fetches the paginated token transfers for the address and renders
 * the table plus pagination. The active tab is tracked via the URL hash (#tokentxns).
 */
export async function AddressTokenTransfersSection({
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
  const data = await getTokenTransfersByAddress(address, LIMIT, offset);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <ResultCount total={total} noun="token transfer" />
      <AddressTokenTransfersTable transfers={data?.transfers ?? []} />
      {total > 0 && (
        <Pagination
          basePath={`/address/${address}`}
          page={page}
          limit={LIMIT}
          total={total}
          noun="token transfers"
          pageParam={pageParam}
          hashSuffix={hashSuffix}
        />
      )}
    </div>
  );
}
