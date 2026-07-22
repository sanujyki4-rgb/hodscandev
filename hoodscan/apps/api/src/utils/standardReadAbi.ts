/**
 * Standard read-only ABIs (ERC-20 / ERC-721 / ERC-1155) for the address
 * page's "Read Contract" tab (Phase 1).
 *
 * We don't have per-contract verified source/ABIs yet, so we expose the
 * `view`/`pure` functions defined by the token standards a contract is
 * detected to implement. Every call goes to the user's own Robinhood
 * Chain RPC node — no external APIs. Mirrors the viem client + caching
 * philosophy of contractType.ts / tokenResolver.ts.
 */
import type { AbiFunction } from "viem";
import { getContractType } from "./contractType";
import { getTokenMetadata } from "./tokenResolver";
import { readRpcClient } from "./rpcClient";
import { redis } from "../middlewares/cache";

/** Re-export shared multi-RPC client for controllers that import from here. */
export { readRpcClient };

export type ReadStandard = "erc20" | "erc721" | "erc1155";

/** view/pure functions we expose per standard, as viem ABI fragments. */
export const READ_ABIS: Record<ReadStandard, readonly AbiFunction[]> = {
  erc20: [
    { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
    {
      name: "allowance",
      type: "function",
      stateMutability: "view",
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      outputs: [{ type: "uint256" }],
    },
  ],
  erc721: [
    { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
    {
      name: "ownerOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [{ type: "address" }],
    },
    {
      name: "tokenURI",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [{ type: "string" }],
    },
    {
      name: "getApproved",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [{ type: "address" }],
    },
    {
      name: "isApprovedForAll",
      type: "function",
      stateMutability: "view",
      inputs: [
        { name: "owner", type: "address" },
        { name: "operator", type: "address" },
      ],
      outputs: [{ type: "bool" }],
    },
    {
      name: "supportsInterface",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "interfaceId", type: "bytes4" }],
      outputs: [{ type: "bool" }],
    },
  ],
  erc1155: [
    {
      name: "uri",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "id", type: "uint256" }],
      outputs: [{ type: "string" }],
    },
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [
        { name: "account", type: "address" },
        { name: "id", type: "uint256" },
      ],
      outputs: [{ type: "uint256" }],
    },
    {
      name: "isApprovedForAll",
      type: "function",
      stateMutability: "view",
      inputs: [
        { name: "account", type: "address" },
        { name: "operator", type: "address" },
      ],
      outputs: [{ type: "bool" }],
    },
    {
      name: "supportsInterface",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "interfaceId", type: "bytes4" }],
      outputs: [{ type: "bool" }],
    },
  ],
};

/**
 * Detect which token standard's read ABI to offer for an address.
 *
 * ERC-165 positively identifies ERC-721/1155 (contractType.ts). ERC-20
 * has no ERC-165 id, so we infer it: if the address resolves any ERC-20
 * metadata (decimals/symbol/name) it's treated as erc20. Returns null
 * when the contract matches no known standard (Phase 1 has no verified
 * ABI to fall back on).
 */
// Cache the detected standard so the cold read-contract path doesn't repeat
// the ERC-165 / metadata RPC probes for the same address on every request.
const STANDARD_TTL = 300; // seconds — cache a positively detected standard
const STANDARD_NULL_TTL = 30; // seconds — briefly cache "no known standard"
const standardKey = (addr: string) => `hoodscan:readstd:${addr}`;

export async function detectReadStandard(address: string): Promise<ReadStandard | null> {
  const addr = address.toLowerCase();
  const key = standardKey(addr);

  // Best-effort cache hit. An empty-string sentinel means "cached null".
  try {
    const cached = await redis.get(key);
    if (cached !== null) return cached === "" ? null : (cached as ReadStandard);
  } catch {
    // ignore cache read failures — fall through to a live detection
  }

  const result = await detectReadStandardLive(addr);

  try {
    await redis.set(key, result ?? "", "EX", result === null ? STANDARD_NULL_TTL : STANDARD_TTL);
  } catch {
    // ignore cache write failures
  }

  return result;
}

/** Live standard detection (RPC probes), used behind the Redis cache above. */
async function detectReadStandardLive(address: string): Promise<ReadStandard | null> {
  const type = await getContractType(address, true);
  if (type === "erc721" || type === "erc1155") return type;

  // Not an ERC-165 NFT — probe for ERC-20 metadata.
  const meta = await getTokenMetadata(address, true);
  if (meta && (meta.decimals !== null || meta.symbol !== null || meta.name !== null)) {
    return "erc20";
  }
  return null;
}

/** Find a read function fragment by name within a standard's ABI. */
export function findReadFunction(
  standard: ReadStandard,
  name: string
): AbiFunction | undefined {
  return READ_ABIS[standard].find((f) => f.name === name);
}

/**
 * Coerce a string argument (from the JSON request body) into the JS type
 * viem expects for the given Solidity input type.
 */
export function coerceArg(value: string, solidityType: string): unknown {
  const t = solidityType.toLowerCase();
  if (t.startsWith("uint") || t.startsWith("int")) return BigInt(value);
  if (t === "bool") return value === "true" || value === "1";
  // address, bytes, bytesN, string — pass through as-is.
  return value;
}

/** Render a decoded read result as a display string for the UI. */
export function displayReadResult(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(displayReadResult).join(", ");
  return String(value);
}
