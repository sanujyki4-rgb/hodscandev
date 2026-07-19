/**
 * Solidity source-code verification service.
 *
 * Compiles user-submitted source with the *exact* solc version they used,
 * then compares the compiled runtime (deployed) bytecode against the code
 * actually on-chain (via the user's own RPC node). On a match we can trust
 * the accompanying ABI — that real ABI is what unlocks full Read/Write
 * Contract beyond the standard ERC fragments.
 *
 * Self-contained: solc runs locally (compiler binaries are fetched once
 * from the official solc-bin and cached in-process); bytecode comes from
 * your RPC node. No external verification API.
 */
import solc from "solc";
import type { AbiFunction } from "viem";
import { getContractBytecode } from "./isContract";

/** In-process cache of loaded compiler snapshots, keyed by full version. */
const compilerCache = new Map<string, { compile(input: string): string }>();

/**
 * Load a specific solc version (e.g. "v0.8.24+commit.e11b9ed9"). The
 * version string must be the long form as reported by solc / listed in
 * the official binaries manifest. Cached after first load.
 */
function loadCompiler(version: string): Promise<{ compile(input: string): string }> {
  const cached = compilerCache.get(version);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    solc.loadRemoteVersion(version, (err, snapshot) => {
      if (err) return reject(err);
      compilerCache.set(version, snapshot);
      resolve(snapshot);
    });
  });
}

export interface VerifyInput {
  address: string;
  sourceCode: string;
  contractName: string;
  compilerVersion: string;
  optimizationEnabled: boolean;
  optimizationRuns: number;
  evmVersion?: string;
}

export interface VerifyResult {
  matched: boolean;
  abi: unknown[];
  compiledBytecode: string;
}

/**
 * Remove the trailing Solidity metadata (CBOR) section so two builds that
 * differ only in their embedded metadata hash still compare equal.
 *
 * Layout: `...runtime... <CBOR metadata> <2-byte big-endian length>`.
 * The final 2 bytes give the metadata length N (in bytes); we drop the
 * last (N + 2) bytes. Best-effort — returns the input unchanged if it
 * doesn't look well-formed.
 */
export function stripMetadata(hex: string): string {
  const clean = hex.toLowerCase().replace(/^0x/, "");
  if (clean.length < 4) return clean;
  const lenHex = clean.slice(-4);
  const metaLenBytes = parseInt(lenHex, 16);
  if (Number.isNaN(metaLenBytes)) return clean;
  const dropChars = (metaLenBytes + 2) * 2;
  if (dropChars >= clean.length) return clean;
  return clean.slice(0, clean.length - dropChars);
}

function normalize(hex: string): string {
  return (hex ?? "").toLowerCase().replace(/^0x/, "");
}

/**
 * Compile the submitted source and compare its deployed bytecode with the
 * on-chain runtime code. Throws on compiler errors or when the named
 * contract can't be found; otherwise returns { matched, abi }.
 */
export async function verifyContractSource(input: VerifyInput): Promise<VerifyResult> {
  const compiler = await loadCompiler(input.compilerVersion);

  const settings: Record<string, unknown> = {
    optimizer: {
      enabled: input.optimizationEnabled,
      runs: input.optimizationRuns,
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.deployedBytecode.object"],
      },
    },
  };
  if (input.evmVersion) settings.evmVersion = input.evmVersion;

  const standardInput = {
    language: "Solidity",
    sources: {
      "Contract.sol": { content: input.sourceCode },
    },
    settings,
  };

  const rawOutput = compiler.compile(JSON.stringify(standardInput));
  const output = JSON.parse(rawOutput) as {
    errors?: { severity: string; formattedMessage?: string; message?: string }[];
    contracts?: Record<
      string,
      Record<string, { abi: unknown[]; evm?: { deployedBytecode?: { object?: string } } }>
    >;
  };

  const fatal = (output.errors ?? []).filter((e) => e.severity === "error");
  if (fatal.length > 0) {
    const msg = fatal.map((e) => e.formattedMessage ?? e.message ?? "Compilation error").join("\n");
    throw new Error(msg);
  }

  // Find the requested contract by name across every compiled source file.
  let found: { abi: unknown[]; bytecode: string } | null = null;
  for (const file of Object.keys(output.contracts ?? {})) {
    const contracts = output.contracts![file];
    if (contracts[input.contractName]) {
      const c = contracts[input.contractName];
      found = {
        abi: c.abi ?? [],
        bytecode: c.evm?.deployedBytecode?.object ?? "",
      };
      break;
    }
  }

  if (!found) {
    throw new Error(
      `Contract "${input.contractName}" not found in the compiled output. Check the contract name.`
    );
  }

  const onchain = normalize(await getContractBytecode(input.address));
  const compiled = normalize(found.bytecode);

  const matched =
    compiled.length > 0 &&
    (compiled === onchain || stripMetadata(compiled) === stripMetadata(onchain));

  return { matched, abi: found.abi, compiledBytecode: found.bytecode };
}

/** Type guard-ish helper: is an ABI entry a read (view/pure) function? */
export function isReadAbiFunction(item: unknown): item is AbiFunction {
  return (
    !!item &&
    typeof item === "object" &&
    (item as AbiFunction).type === "function" &&
    ((item as AbiFunction).stateMutability === "view" ||
      (item as AbiFunction).stateMutability === "pure")
  );
}
