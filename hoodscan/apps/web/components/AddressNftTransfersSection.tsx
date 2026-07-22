import { getNftTransfersByAddress } from "@/lib/api";
import { AddressNftTransfersTable } from "@/components/AddressNftTransfersTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Server component for the address page's "NFT Transfers" tab. Fetches the
 * paginated ERC-721 / ERC-1155 transfers for the address and renders the
 * table plus pagination. The active tab is tracked via the URL hash (#nfttransfers).
 */
export async function AddressNftTransfersSection({
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
  const data = await getNftTransfersByAddress(address, LIMIT, offset);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <ResultCount total={total} noun="NFT transfer" />
      <AddressNftTransfersTable transfers={data?.transfers ?? []} />
      {total > 0 && (
        <Pagination
          basePath={`/address/${address}`}
          page={page}
          limit={LIMIT}
          total={total}
          noun="NFT transfers"
          pageParam={pageParam}
          hashSuffix={hashSuffix}
        />
      )}
    </div>
  );
}
