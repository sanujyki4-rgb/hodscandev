import { getAddressTokenHoldings } from "@/lib/api";
import { AddressTokenHoldingsTable } from "@/components/AddressTokenHoldingsTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Server component for the address page's "Token Holdings" (ERC-20
 * portfolio) tab. Fetches the paginated current holdings for the address
 * and renders the table plus pagination. Active tab tracked via #assets.
 */
export async function AddressTokenHoldingsSection({
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
  const data = await getAddressTokenHoldings(address, LIMIT, offset);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <ResultCount total={total} noun="token" />
      <AddressTokenHoldingsTable holdings={data?.holdings ?? []} />
      {total > 0 && (
        <Pagination
          basePath={`/address/${address}`}
          page={page}
          limit={LIMIT}
          total={total}
          noun="tokens"
          pageParam={pageParam}
          hashSuffix={hashSuffix}
        />
      )}
    </div>
  );
}
