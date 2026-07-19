import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { getAddressLabel } from "@hoodscan/types";
import { getTokenMetadata } from "../utils/tokenResolver";
import { formatTokenAmount, decimalToBigInt } from "../utils/formatToken";
import { isContractAddress } from "../utils/isContract";
import { resolveContractInfo } from "../utils/contractNames";
import { readRpcClient } from "../utils/standardReadAbi";

const ZERO = "0x0000000000000000000000000000000000000000";
import { ADDRESS_RE } from "../utils/address";

const TOTAL_SUPPLY_ABI = [
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Best-effort on-chain totalSupply() read. Returns raw bigint or null. */
async function readTotalSupply(address: string): Promise<bigint | null> {
  try {
    const result = await readRpcClient.readContract({
      address: address as `0x${string}`,
      abi: TOTAL_SUPPLY_ABI,
      functionName: "totalSupply",
    });
    return result as bigint;
  } catch {
    return null;
  }
}

/**
 * GET /tokens?limit=25&offset=0
 *
 * Lists ERC-20 tokens the indexer has seen Transfer events for, ranked by
 * transfer count (most active first). Derived from the TokenTransfer table
 * — no separate token registry needed. Metadata is cache-only here
 * (allowRemote=false) so the list stays fast; the detail view warms the
 * cache with live on-chain reads.
 */
export async function listTokens(req: Request, res: Response) {
  const { limit, offset } = parsePagination(req, 25, 100);

  const grouped = await prisma.tokenTransfer.groupBy({
    by: ["tokenAddress"],
    _count: { _all: true },
    orderBy: { _count: { tokenAddress: "desc" } },
    take: limit,
    skip: offset,
  });

  const distinctCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(DISTINCT "tokenAddress")::int AS count FROM "TokenTransfer"
  `;
  const total = distinctCount[0]?.count ?? 0;

  const tokens = await Promise.all(
    grouped.map(async (g) => {
      const meta = await getTokenMetadata(g.tokenAddress, false);
      return {
        tokenAddress: g.tokenAddress,
        name: meta?.name ?? null,
        symbol: meta?.symbol ?? null,
        decimals: meta?.decimals ?? null,
        transferCount: g._count._all,
      };
    })
  );

  res.json(
    serializeBigInt({
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      tokens,
    })
  );
}

/**
 * GET /tokens/:address
 * Token overview: metadata (live on-chain), transfer count, and the number
 * of current holders (derived from net transfer balances).
 */
export async function getTokenDetail(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const [meta, transferCount, holderRows, isContract, rawTotalSupply] = await Promise.all([
    getTokenMetadata(address, true),
    prisma.tokenTransfer.count({ where: { tokenAddress: address } }),
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM (
        SELECT addr FROM (
          SELECT "toAddress" AS addr, "amount" AS delta FROM "TokenTransfer" WHERE "tokenAddress" = ${address}
          UNION ALL
          SELECT "fromAddress" AS addr, -"amount" AS delta FROM "TokenTransfer" WHERE "tokenAddress" = ${address}
        ) t
        WHERE addr <> ${ZERO}
        GROUP BY addr
        HAVING SUM(delta) > 0
      ) h
    `,
    isContractAddress(address, true),
    readTotalSupply(address),
  ]);

  res.json(
    serializeBigInt({
      tokenAddress: address,
      name: meta?.name ?? null,
      symbol: meta?.symbol ?? null,
      decimals: meta?.decimals ?? null,
      isContract,
      transferCount,
      holderCount: holderRows[0]?.count ?? 0,
      rawTotalSupply: rawTotalSupply !== null ? rawTotalSupply.toString() : null,
      totalSupply:
        rawTotalSupply !== null
          ? formatTokenAmount(rawTotalSupply, meta?.decimals ?? null)
          : null,
    })
  );
}

/**
 * GET /tokens/:address/transfers?limit=25&offset=0
 * All ERC-20 Transfer events for a single token, newest first.
 */
export async function listTokenTransfers(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = { tokenAddress: address };
  const [transfers, total, meta] = await Promise.all([
    prisma.tokenTransfer.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.tokenTransfer.count({ where }),
    getTokenMetadata(address, true),
  ]);
  const decimals = meta?.decimals ?? null;

  const partyAddresses = [
    ...new Set(transfers.flatMap((t) => [t.fromAddress, t.toAddress])),
  ];
  // Contract icons + verified names for From/To parties (shared helper).
  const { isContract: isContractByAddr, names: partyNameByAddr } =
    await resolveContractInfo(partyAddresses);

  const rows = transfers.map((t) => {
    const raw = decimalToBigInt(t.amount);
    return {
      txHash: t.txHash,
      logIndex: t.logIndex,
      blockNumber: t.blockNumber,
      timestamp: t.timestamp,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      rawAmount: raw.toString(),
      amount: formatTokenAmount(raw, decimals),
      fromLabel: getAddressLabel(t.fromAddress) ?? partyNameByAddr.get(t.fromAddress) ?? null,
      toLabel: getAddressLabel(t.toAddress) ?? partyNameByAddr.get(t.toAddress) ?? null,
      fromIsContract: isContractByAddr.get(t.fromAddress) ?? null,
      toIsContract: isContractByAddr.get(t.toAddress) ?? null,
    };
  });

  res.json(
    serializeBigInt({
      tokenAddress: address,
      name: meta?.name ?? null,
      symbol: meta?.symbol ?? null,
      decimals,
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      transfers: rows,
    })
  );
}

/**
 * GET /tokens/:address/holders?limit=25&offset=0
 *
 * Current holders, derived from net transfer balances (sum of incoming
 * minus outgoing amounts per address, over all indexed transfers of this
 * token). This is an approximation bounded by what the indexer has seen —
 * addresses with a positive net balance are listed, ranked by balance.
 * The zero address (mints/burns) is excluded.
 */
export async function listTokenHolders(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const meta = await getTokenMetadata(address, true);
  const decimals = meta?.decimals ?? null;

  const [holders, totalRows, totalSupply] = await Promise.all([
    prisma.$queryRaw<{ addr: string; balance: string }[]>`
      SELECT addr, SUM(delta)::text AS balance FROM (
        SELECT "toAddress" AS addr, "amount" AS delta FROM "TokenTransfer" WHERE "tokenAddress" = ${address}
        UNION ALL
        SELECT "fromAddress" AS addr, -"amount" AS delta FROM "TokenTransfer" WHERE "tokenAddress" = ${address}
      ) t
      WHERE addr <> ${ZERO}
      GROUP BY addr
      HAVING SUM(delta) > 0
      ORDER BY SUM(delta) DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM (
        SELECT addr FROM (
          SELECT "toAddress" AS addr, "amount" AS delta FROM "TokenTransfer" WHERE "tokenAddress" = ${address}
          UNION ALL
          SELECT "fromAddress" AS addr, -"amount" AS delta FROM "TokenTransfer" WHERE "tokenAddress" = ${address}
        ) t
        WHERE addr <> ${ZERO}
        GROUP BY addr
        HAVING SUM(delta) > 0
      ) h
    `,
    readTotalSupply(address),
  ]);

  const total = totalRows[0]?.count ?? 0;
  // Contract icons + verified names for holders (shared helper).
  const { isContract: isContractByAddr, names: nameByAddr } =
    await resolveContractInfo(holders.map((h) => h.addr));

  const rows = holders.map((h, i) => {
    const raw = BigInt(h.balance);
    // Share of total supply, in percent. Computed with bigint math at
    // sub-percent precision to avoid float overflow on large uint256
    // balances, then converted to a Number for the response.
    let percentage: number | null = null;
    if (totalSupply && totalSupply > 0n) {
      percentage = Number((raw * 1000000n) / totalSupply) / 10000;
    }
    return {
      rank: offset + i + 1,
      address: h.addr,
      label: getAddressLabel(h.addr) ?? nameByAddr.get(h.addr) ?? null,
      rawBalance: h.balance,
      balance: formatTokenAmount(raw, decimals),
      percentage,
      isContract: isContractByAddr.get(h.addr) ?? null,
    };
  });

  res.json(
    serializeBigInt({
      tokenAddress: address,
      name: meta?.name ?? null,
      symbol: meta?.symbol ?? null,
      decimals,
      totalSupply: totalSupply !== null ? totalSupply.toString() : null,
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      holders: rows,
    })
  );
}
