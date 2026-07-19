import { getAddressContract } from "@/lib/api";
import { ContractPanel } from "@/components/ContractPanel";

/**
 * Address page "Contract" tab (server component).
 *
 * Fetches the on-chain bytecode, then hands off to the interactive
 * <ContractPanel> which provides the Code / Read Contract sub-tabs.
 * Write Contract and verified source are future phases.
 */
export async function ContractCodeSection({ address }: { address: string }) {
  const data = await getAddressContract(address);
  const bytecode = data?.bytecode ?? "0x";
  const sizeBytes = data?.sizeBytes ?? 0;

  return <ContractPanel address={address} bytecode={bytecode} sizeBytes={sizeBytes} />;
}
