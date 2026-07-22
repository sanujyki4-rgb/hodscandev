/**
 * Helpers for reading a contract's *verified* ABI and splitting it into
 * read (view/pure) and write (state-changing) functions.
 *
 * Verified data can come from our own DB (VerifiedContract, populated by
 * the solc verify flow) or the chain's Blockscout explorer (fetched on
 * demand and cached). Proxies additionally resolve their implementation's
 * ABI so Read/Write operate on the real functions (Read/Write as Proxy).
 */
import { prisma } from "@hoodscan/database";
import type { AbiFunction } from "viem";
import { fetchBlockscoutVerification } from "./blockscoutVerification";
import { redis } from "../middlewares/cache";

// Negative cache: addresses that aren't verified anywhere. Without this, every
// read-contract / verification request re-hits the slow external explorer for
// the same unverified address. Positive results are already cached in our DB.
const UNVERIFIED_TTL = 300; // seconds
const unverifiedKey = (addr: string) => `hoodscan:unverified:${addr}`;

export interface VerifiedContractRecord {
  address: string;
  contractName: string;
  compilerVersion: string;
  optimizationEnabled: boolean;
  optimizationRuns: number;
  evmVersion: string | null;
  sourceCode: string;
  abi: unknown[];
  constructorArguments: string | null;
  proxyType: string | null;
  implementationAddress: string | null;
  verifiedAt: Date;
}

/** The verified view used for calls/display, with proxy implementation resolved. */
export interface ResolvedContract {
  record: VerifiedContractRecord;
  /** ABI to use for Read/Write calls — implementation ABI for proxies. */
  effectiveAbi: unknown[];
  /** Populated when the contract is a proxy and its implementation is verified. */
  implementation: VerifiedContractRecord | null;
}

function parseAbi(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** DB-only lookup: returns the stored verified contract, or null. */
export async function getVerifiedContract(
  address: string
): Promise<VerifiedContractRecord | null> {
  const addr = address.toLowerCase();
  const row = await prisma.verifiedContract.findUnique({ where: { address: addr } });
  if (!row) return null;
  return { ...row, abi: parseAbi(row.abi) };
}

/**
 * Resolve a verified contract, preferring our DB and falling back to the
 * Blockscout explorer. When Blockscout has it, we cache the result into
 * our DB. For proxies we also (best-effort) cache the implementation so a
 * later effective-ABI resolution stays local.
 */
export async function getOrFetchVerifiedContract(
  address: string
): Promise<VerifiedContractRecord | null> {
  const addr = address.toLowerCase();

  const local = await getVerifiedContract(addr);
  if (local) return local;

  // Skip the slow external explorer for addresses we recently found unverified.
  try {
    if (await redis.get(unverifiedKey(addr))) return null;
  } catch {
    // ignore cache read failures — fall through to a live fetch
  }

  const remote = await fetchBlockscoutVerification(addr);
  if (!remote) {
    // Negatively cache so repeat lookups don't re-hit the explorer.
    try {
      await redis.set(unverifiedKey(addr), "1", "EX", UNVERIFIED_TTL);
    } catch {
      // ignore cache write failures
    }
    return null;
  }

  const data = {
    contractName: remote.contractName,
    compilerVersion: remote.compilerVersion,
    optimizationEnabled: remote.optimizationEnabled,
    optimizationRuns: remote.optimizationRuns,
    evmVersion: remote.evmVersion,
    sourceCode: remote.sourceCode,
    abi: JSON.stringify(remote.abi),
    constructorArguments: remote.constructorArguments,
    proxyType: remote.proxyType,
    implementationAddress: remote.implementationAddress,
  };

  try {
    await prisma.verifiedContract.upsert({
      where: { address: addr },
      create: { address: addr, ...data },
      update: data,
    });
  } catch {
    /* caching is best-effort */
  }

  // Pre-cache the implementation for proxies (best-effort, non-blocking-ish).
  if (remote.implementationAddress) {
    try {
      await getOrFetchVerifiedContract(remote.implementationAddress);
    } catch {
      /* ignore */
    }
  }

  return {
    address: addr,
    contractName: remote.contractName,
    compilerVersion: remote.compilerVersion,
    optimizationEnabled: remote.optimizationEnabled,
    optimizationRuns: remote.optimizationRuns,
    evmVersion: remote.evmVersion,
    sourceCode: remote.sourceCode,
    abi: remote.abi,
    constructorArguments: remote.constructorArguments,
    proxyType: remote.proxyType,
    implementationAddress: remote.implementationAddress,
    verifiedAt: new Date(),
  };
}

/**
 * Resolve a contract for calls/display, following the proxy to its
 * implementation ABI when present. Returns null when the contract isn't
 * verified anywhere.
 */
export async function resolveContract(address: string): Promise<ResolvedContract | null> {
  const record = await getOrFetchVerifiedContract(address);
  if (!record) return null;

  let implementation: VerifiedContractRecord | null = null;
  if (record.implementationAddress) {
    implementation = await getOrFetchVerifiedContract(record.implementationAddress);
  }

  const effectiveAbi =
    implementation && implementation.abi.length > 0 ? implementation.abi : record.abi;

  return { record, effectiveAbi, implementation };
}

function isFunctionEntry(item: unknown): item is AbiFunction {
  return (
    !!item &&
    typeof item === "object" &&
    (item as { type?: string }).type === "function"
  );
}

/** Split a parsed ABI into read (view/pure) and write (nonpayable/payable) fns. */
export function splitAbi(abi: unknown[]): { reads: AbiFunction[]; writes: AbiFunction[] } {
  const reads: AbiFunction[] = [];
  const writes: AbiFunction[] = [];
  for (const item of abi) {
    if (!isFunctionEntry(item)) continue;
    const sm = item.stateMutability;
    if (sm === "view" || sm === "pure") reads.push(item);
    else writes.push(item);
  }
  return { reads, writes };
}
