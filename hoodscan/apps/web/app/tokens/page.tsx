import { TokensTable } from "@/components/TokensTable";
import { Pagination } from "@/components/Pagination";
import { getTokens } from "@/lib/api";

export const revalidate = 10;

const LIMIT = 25;

/**
 * Token list page (/tokens). ERC-20 tokens the indexer has seen Transfer
 * events for, ranked by transfer count. Derived from the TokenTransfer
 * table — no separate registry.
 */
export default async function TokensPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(Number(searchParams.page) || 1, 1);
  const offset = (page - 1) * LIMIT;

  const data = await getTokens(LIMIT, offset);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Tokens (ERC-20)
        </h1>
        <p className="text-sm text-muted">
          Ranked by transfer activity seen by the indexer.
        </p>
      </div>

      {data === null ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          Couldn&apos;t reach the hoodscan API.
        </p>
      ) : (
        <>
          <TokensTable tokens={data.tokens} />
          <Pagination
            basePath="/tokens"
            page={page}
            limit={data.limit}
            total={data.total}
            noun="tokens"
          />
        </>
      )}
    </div>
  );
}
