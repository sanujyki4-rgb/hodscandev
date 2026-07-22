/**
 * Fetch already-verified contract source + ABI from the chain's official
 * Blockscout explorer, including proxy → implementation info.
 *
 * This gives hoodscan the Etherscan-style behaviour: a contract that's
 * already verified shows its source/ABI automatically, and proxies expose
 * their implementation's ABI for Read/Write as Proxy. Our own solc verify
 * flow (verifyContract.ts) remains as a fallback.
 *
 * Best-effort: never throws. Returns null when the contract isn't verified
 * there, or on any network/parse error.
 */
import { BLOCK_EXPLORER_URL } from "@hoodscan/config";

// Bound the external explorer call so an unverified / slow-to-respond address
// can't stall verification-dependent endpoints (read-contract, verification).
// A verified contract is cached permanently in our DB after the first hit, so
// the only repeated cost is the negative (not-verified) case — kept short here
// and negatively cached in verifiedAbi.ts.
const BLOCKSCOUT_TIMEOUT_MS = 800;

export interface BlockscoutVerification {
  contractName: string;
  compilerVersion: string;
  optimizationEnabled: boolean;
  optimizationRuns: number;
  evmVersion: string | null;
  sourceCode: string;
  abi: unknown[];
  constructorArguments: string | null;
  /** Proxy standard reported by Blockscout (e.g. "eip1967"), if any. */
  proxyType: string | null;
  /** Implementation address for a proxy (lowercased), if any. */
  implementationAddress: string | null;
}

interface BlockscoutAdditionalSource {
  file_path?: string;
  source_code?: string;
}

interface BlockscoutImplementation {
  address?: string;
  address_hash?: string;
  name?: string | null;
}

interface BlockscoutSmartContract {
  name?: string;
  compiler_version?: string;
  optimization_enabled?: boolean;
  optimization_runs?: number | null;
  evm_version?: string | null;
  source_code?: string;
  file_path?: string;
  abi?: unknown[] | null;
  constructor_args?: string | null;
  is_verified?: boolean;
  additional_sources?: BlockscoutAdditionalSource[];
  proxy_type?: string | null;
  implementations?: BlockscoutImplementation[];
}

/**
 * GET {explorer}/api/v2/smart-contracts/{address}. Combines the main
 * source with any additional (multi-file) sources into one annotated
 * string for display, and extracts proxy/implementation info. Returns
 * null unless the contract is verified and exposes an ABI.
 */
export async function fetchBlockscoutVerification(
  address: string
): Promise<BlockscoutVerification | null> {
  const base = BLOCK_EXPLORER_URL.replace(/\/+$/, "");
  const url = `${base}/api/v2/smart-contracts/${address.toLowerCase()}`;

  let data: BlockscoutSmartContract;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(BLOCKSCOUT_TIMEOUT_MS),
    });
    if (!res.ok) return null; // 404 = not a verified contract there
    data = (await res.json()) as BlockscoutSmartContract;
  } catch {
    return null;
  }

  const abi = Array.isArray(data.abi) ? data.abi : null;
  const mainSource = typeof data.source_code === "string" ? data.source_code : "";
  if (!abi || !mainSource) return null; // not verified / no usable data

  // Stitch multi-file sources into a single annotated blob for display.
  let sourceCode = mainSource;
  const mainPath = data.file_path || "Contract.sol";
  const parts: string[] = [`// File: ${mainPath}\n${mainSource}`];
  for (const extra of data.additional_sources ?? []) {
    if (extra?.source_code) {
      parts.push(`// File: ${extra.file_path ?? "source"}\n${extra.source_code}`);
    }
  }
  if (parts.length > 1) sourceCode = parts.join("\n\n");

  // Proxy → implementation (first implementation wins).
  const impl = (data.implementations ?? [])[0];
  const implRaw = impl?.address ?? impl?.address_hash ?? null;
  const implementationAddress = implRaw ? implRaw.toLowerCase() : null;

  return {
    contractName: data.name || "Contract",
    compilerVersion: data.compiler_version || "unknown",
    optimizationEnabled: Boolean(data.optimization_enabled),
    optimizationRuns:
      typeof data.optimization_runs === "number" ? data.optimization_runs : 200,
    evmVersion: data.evm_version ?? null,
    sourceCode,
    abi,
    constructorArguments: data.constructor_args ?? null,
    proxyType: data.proxy_type ?? null,
    implementationAddress,
  };
}
