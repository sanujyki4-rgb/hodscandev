import { getTokenTransfersByAddress } from "@/lib/api";
import { AddressTokenTransfersTable } from "@/components/AddressTokenTransfersTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Server component for the address page's "Token Transfers (ERC-20)"
 * tab. Fetches the paginated token transfers for the address and renders
 * the table plus pagination (preserving the ?tab=token-erc20 query).
 */
export async function AddressTokenTransfersSection({
  address,
  page,
}: {
  address: string;
  page: number;
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
          queryPrefix="tab=token-erc20&"
        />
      )}
    </div>
  );
}
