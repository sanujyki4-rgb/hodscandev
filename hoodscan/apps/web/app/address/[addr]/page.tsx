import { notFound } from "next/navigation";
import { getTransactionsByAddress, getVerification } from "@/lib/api";
import { AddressTabs, parseAddressTab } from "@/components/AddressTabs";
import { AddressTxTable } from "@/components/AddressTxTable";
import { AddressTokenTransfersSection } from "@/components/AddressTokenTransfersSection";
import { AddressNftTransfersSection } from "@/components/AddressNftTransfersSection";
import { ContractCodeSection } from "@/components/ContractCodeSection";
import { ContractIcon } from "@/components/ContractIcon";
import { AddressTabPlaceholder } from "@/components/AddressTabPlaceholder";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";

export const revalidate = 5;

const LIMIT = 25;

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: { addr: string };
  searchParams: { tab?: string; page?: string };
}) {
  const page = Math.max(Number(searchParams.page) || 1, 1);
  const offset = (page - 1) * LIMIT;
  const requestedTab = searchParams.tab ?? "transactions";

  // Always load tx summary so the Transactions tab count is accurate even on other tabs.
  const data = await getTransactionsByAddress(
    params.addr,
    LIMIT,
    requestedTab === "transactions" ? offset : 0
  );

  if (!data) notFound();

  const address = data.address.startsWith("0x") ? data.address : params.addr;
  const isContract = data.isContract ?? false;
  // Which tabs exist (and are valid) depends on the address type.
  const tab = parseAddressTab(searchParams.tab, isContract, data.hasNftActivity ?? false);

  // For contracts, check verification status so the Contract tab can show a ✓.
  const contractVerified = isContract
    ? (await getVerification(address).catch(() => null))?.verified === true
    : false;

  return (
    <div className="flex flex-col gap-6">
      {/* Minimal header — overview cards later */}
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          {data.isContract ? <ContractIcon /> : null}
          {data.isContract ? "Contract" : "Address"}
        </h1>
        <p className="break-all font-mono text-sm text-muted">{address}</p>
      </div>

      <div className="flex flex-col gap-4">
        <AddressTabs address={address} active={tab} isContract={isContract} hasNftActivity={data.hasNftActivity ?? false} contractVerified={contractVerified} />

        {tab === "transactions" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <ResultCount total={data.total} noun="transaction" />
            </div>
            <AddressTxTable address={address} transactions={data.transactions} />
            {data.total > 0 && (
              <Pagination
                basePath={`/address/${address}`}
                page={page}
                limit={LIMIT}
                total={data.total}
              />
            )}
          </div>
        ) : tab === "token-erc20" ? (
          <AddressTokenTransfersSection address={address} page={page} />
        ) : tab === "nft" ? (
          <AddressNftTransfersSection address={address} page={page} />
        ) : tab === "contract" ? (
          <ContractCodeSection address={address} />
        ) : (
          <AddressTabPlaceholder tab={tab} />
        )}
      </div>
    </div>
  );
}
