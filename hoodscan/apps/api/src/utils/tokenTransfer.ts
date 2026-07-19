/**
 * Layer 2 — decode an ERC-20 token-transfer transaction into a
 * human-readable asset ("1,250 USDC"), Etherscan-style.
 *
 * Self-reliant: the amount is decoded from the raw calldata locally,
 * and the token's symbol/decimals come from Layer 1's on-chain
 * tokenResolver (talks ONLY to the user's own RPC node + Redis cache —
 * no external APIs). Best-effort: any failure returns null so the
 * detail endpoint never breaks just because a transfer couldn't be
 * decoded or the token metadata couldn't be read.
 *
 * Consumed by the single-tx detail endpoint (transactions.controller.ts).
 */
import { decodeFunctionData, formatUnits } from "viem";
import { getTokenMetadata } from "./tokenResolver";
import { getContractType } from "./contractType";

// ERC-20 transfer selectors we render as an asset.
const SEL_TRANSFER = "0xa9059cbb"; // transfer(address,uint256)
const SEL_TRANSFER_FROM = "0x23b872dd"; // transferFrom(address,address,uint256)

/**
 * Minimal ABI for the two ERC-20 transfer entry points. transferFrom is
 * shared with ERC-721, so callers must guard NFTs (see resolveTokenTransfer).
 */
const TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "transferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export type TokenTransferInfo = {
  /** The ERC-20 contract address (the tx's `to`). */
  tokenAddress: string;
  /** Sender — only present for transferFrom; null for a plain transfer. */
  from: string | null;
  /** Recipient of the tokens. */
  to: string;
  /** Raw on-chain amount (base units), as a decimal string. */
  rawAmount: string;
  /**
   * Amount scaled by the token's decimals and formatted with thousands
   * separators (e.g. "1,250.5"). Null when decimals couldn't be read —
   * the caller should fall back to rawAmount.
   */
  amount: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
};

/**
 * Scale a raw base-unit amount by `decimals` and add thousands
 * separators to the integer part. Returns null if decimals is unknown
 * or formatting fails.
 */
function formatAmount(raw: bigint, decimals: number | null): string | null {
  if (decimals === null) return null;
  try {
    const formatted = formatUnits(raw, decimals);
    const [intPart, fracPart] = formatted.split(".");
    const withCommas = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fracPart ? `${withCommas}.${fracPart}` : withCommas;
  } catch {
    return null;
  }
}

/**
 * Decode an ERC-20 transfer/transferFrom tx into a displayable asset.
 *
 * Returns null when:
 *  - the selector isn't a token transfer,
 *  - the calldata can't be decoded, or
 *  - the target contract is an NFT (ERC-721/1155) — for those,
 *    transferFrom's third arg is a tokenId, not an amount, so it's
 *    handled by the "NFT Transfer" method label instead.
 *
 * `allowRemote` mirrors the rest of the codebase: the detail endpoint
 * passes true (live on-chain reads allowed); list endpoints pass false.
 */
export async function resolveTokenTransfer(
  input: string | null | undefined,
  selector: string | null | undefined,
  contractAddress: string | null | undefined,
  allowRemote = false
): Promise<TokenTransferInfo | null> {
  const sel = (selector ?? "").trim().toLowerCase();
  const data = (input ?? "").trim();
  const addr = (contractAddress ?? "").trim().toLowerCase();

  if (!addr) return null;
  if (sel !== SEL_TRANSFER && sel !== SEL_TRANSFER_FROM) return null;
  if (!data || data === "0x" || data.length < 10) return null;

  let from: string | null = null;
  let to: string;
  let value: bigint;

  try {
    const { functionName, args } = decodeFunctionData({
      abi: TRANSFER_ABI,
      data: data as `0x${string}`,
    });
    if (functionName === "transfer") {
      to = (args[0] as string).toLowerCase();
      value = args[1] as bigint;
    } else {
      from = (args[0] as string).toLowerCase();
      to = (args[1] as string).toLowerCase();
      value = args[2] as bigint;
    }
  } catch {
    return null;
  }

  // transferFrom is shared with ERC-721/1155 — skip NFTs (their third
  // arg is a tokenId, not a fungible amount).
  if (sel === SEL_TRANSFER_FROM) {
    const ctype = await getContractType(addr, allowRemote);
    if (ctype === "erc721" || ctype === "erc1155") return null;
  }

  const meta = await getTokenMetadata(addr, allowRemote);
  const decimals = meta?.decimals ?? null;

  return {
    tokenAddress: addr,
    from,
    to,
    rawAmount: value.toString(),
    amount: formatAmount(value, decimals),
    symbol: meta?.symbol ?? null,
    name: meta?.name ?? null,
    decimals,
  };
}
