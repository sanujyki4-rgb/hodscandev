import { getOtherTransactionsByAddress } from "@/lib/api";
import { AddressTxTable } from "@/components/AddressTxTable";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

const LIMIT = 25;

/**
 * Address page "Other Transactions" tab. Lists non-standard transactions
 * (L1↔L2 messages and ArbOS system txs — txType not 0x0/0x1/0x2) where this
 * address is the sender or recipient. Reuses AddressTxTable so it matches the
 * main Transactions tab exactly. Active tab tracked via the URL hash (#othertxns).
 */
export async function AddressOtherTxSection({
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
  const data = await getOtherTransactionsByAddress(address, LIMIT, offset);
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <ResultCount total={total} noun="transaction" />
      <AddressTxTable address={address} transactions={data?.transactions ?? []} />
      {total > 0 && (
        <Pagination
          basePath={`/address/${address}`}
          page={page}
          limit={LIMIT}
          total={total}
          noun="transactions"
          pageParam={pageParam}
          hashSuffix={hashSuffix}
        />
      )}
    </div>
  );
}
