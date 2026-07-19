/**
 * Shared resolver for the "is this address a contract, and what's its verified
 * name?" question used by list endpoints (token Holders, token Transfers, and
 * anywhere else that shows addresses Etherscan-style).
 *
 * For a set of addresses it:
 *   1. detects which are smart contracts (eth_getCode via isContractAddress,
 *      cached), and
 *   2. for the contracts, looks up the verified Solidity contract name from our
 *      VerifiedContract store (batched DB read) and auto-resolves + caches any
 *      that aren't stored yet — so a name (e.g. "UniswapV3Pool", "PoolManager")
 *      shows up immediately, without the user opening the contract page first.
 *
 * Best-effort throughout: RPC/Blockscout/DB hiccups never throw here, callers
 * just get whatever could be resolved.
 */
import { prisma } from "@hoodscan/database";
import { isContractAddress } from "./isContract";
import { getOrFetchVerifiedContract } from "./verifiedAbi";

export interface ContractInfo {
  /** address (lowercased) -> is-contract flag (true/false, or null if unknown). */
  isContract: Map<string, boolean | null>;
  /** address (lowercased) -> verified Solidity contract name. */
  names: Map<string, string>;
}

/**
 * Resolve contract flags + verified names for a list of addresses. Input may
 * contain duplicates and mixed casing; keys in the returned maps are lowercased.
 */
export async function resolveContractInfo(addresses: string[]): Promise<ContractInfo> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];

  // 1. Which addresses are contracts? Small pages + cached results, so a live
  //    read is fine and gives reliable contract icons.
  const contractEntries = await Promise.all(
    unique.map(async (a) => [a, await isContractAddress(a, true)] as const)
  );
  const isContract = new Map(contractEntries);

  // 2. Verified names for the contracts — DB batch first.
  const contractAddrs = unique.filter((a) => isContract.get(a) === true);
  const known =
    contractAddrs.length > 0
      ? await prisma.verifiedContract.findMany({
          where: { address: { in: contractAddrs } },
          select: { address: true, contractName: true },
        })
      : [];
  const names = new Map<string, string>(known.map((v) => [v.address, v.contractName]));

  // 3. Auto-resolve (and cache) the contracts we don't have a name for yet.
  const missing = contractAddrs.filter((a) => !names.has(a));
  if (missing.length > 0) {
    const resolved = await Promise.allSettled(
      missing.map((a) => getOrFetchVerifiedContract(a))
    );
    resolved.forEach((r, idx) => {
      const addr = missing[idx];
      if (addr && r.status === "fulfilled" && r.value) {
        names.set(addr, r.value.contractName);
      }
    });
  }

  return { isContract, names };
}
