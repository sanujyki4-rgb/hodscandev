import { getAddressEvents } from "@/lib/api";
import { AddressEventsTable } from "@/components/AddressEventsTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Address/contract page "Events" tab. Fetches the paginated event logs emitted
 * by the address (from the indexer's Log table) and renders the table plus
 * pagination. Active tab tracked via the URL hash (#events). Historical rows
 * fill in as the indexer processes blocks / the logs backfill runs.
 */
export async function AddressEventsSection({
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
  const data = await getAddressEvents(address, LIMIT, offset);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <ResultCount total={total} noun="event" />
      <AddressEventsTable rows={data?.events ?? []} />
      {total > 0 && (
        <Pagination
          basePath={`/address/${address}`}
          page={page}
          limit={LIMIT}
          total={total}
          noun="events"
          pageParam={pageParam}
          hashSuffix={hashSuffix}
        />
      )}
    </div>
  );
}
