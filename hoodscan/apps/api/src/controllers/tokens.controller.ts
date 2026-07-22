import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { redis } from "../middlewares/cache";
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

const DETAIL_RPC_TIMEOUT_MS = 1200;
const TOTAL_SUPPLY_TTL = 60; // seconds

/**
 * Race a promise against a timeout, resolving to `fallback` if it does not
 * settle in time. Never rejects — a thrown/slow RPC yields the fallback so
 * the detail page can't be stalled by one slow on-chain read.
 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Cached + timeout-bounded totalSupply() read. Serves a recent value from
 * Redis when present, otherwise does ONE bounded live read and caches it.
 * Best-effort: cache errors are ignored, and a slow node yields null so the
 * caller falls back to the indexer-persisted Token.totalSupply.
 */
async function readTotalSupplyCached(address: string): Promise<bigint | null> {
  const cacheKey = `hoodscan:totalsupply:${address}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === "" ? null : BigInt(cached);
  } catch {
    // ignore cache read failures
  }
  const value = await withTimeout(readTotalSupply(address), DETAIL_RPC_TIMEOUT_MS, null);
  try {
    await redis.set(cacheKey, value === null ? "" : value.toString(), "EX", TOTAL_SUPPLY_TTL);
  } catch {
    // ignore cache write failures
  }
  return value;
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

  // Prefer the persisted Token table (indexer-populated): fast, indexed,
  // and includes holderCount. Fall back to deriving from TokenTransfer
  // when the table is still empty (early in indexing).
  const tokenTableCount = await prisma.token.count();
  if (tokenTableCount > 0) {
    const tokenRows = await prisma.token.findMany({
      orderBy: { transferCount: "desc" },
      take: limit,
      skip: offset,
    });
    return res.json(
      serializeBigInt({
        total: Math.min(tokenTableCount, EXPLORER_LIST_CAP),
        limit,
        offset,
        tokens: tokenRows.map((t) => ({
          tokenAddress: t.address,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
          transferCount: t.transferCount,
          holderCount: t.holderCount,
          logo: t.logoUrl ? `/tokens/${t.address}/logo` : null,
        })),
      })
    );
  }

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

  // Prefer indexer-maintained Token / TokenBalance tables when available.
  const [tokenRow, balanceHolderCount] = await Promise.all([
    prisma.token.findUnique({ where: { address } }),
    prisma.tokenBalance.count({
      where: { tokenAddress: address, balance: { gt: 0 }, ownerAddress: { not: ZERO } },
    }),
  ]);
  if (tokenRow || balanceHolderCount > 0) {
    const [detMeta, detIsContract, detRawSupply, detTransferCount] = await Promise.all([
      // Bound the live on-chain reads so a slow RPC node can't stall the
      // detail page. On timeout we fall back to the indexer-persisted Token
      // row values below; a token row implies the address is a contract.
      withTimeout(getTokenMetadata(address, true), DETAIL_RPC_TIMEOUT_MS, null),
      withTimeout(isContractAddress(address, true), DETAIL_RPC_TIMEOUT_MS, true),
      readTotalSupplyCached(address),
      tokenRow
        ? Promise.resolve(tokenRow.transferCount)
        : prisma.tokenTransfer.count({ where: { tokenAddress: address } }),
    ]);
    const detDecimals = tokenRow?.decimals ?? detMeta?.decimals ?? null;
    const detHolderCount =
      balanceHolderCount > 0 ? balanceHolderCount : tokenRow?.holderCount ?? 0;
    const detSupply =
      detRawSupply ??
      (tokenRow?.totalSupply ? decimalToBigInt(tokenRow.totalSupply) : null);
    return res.json(
      serializeBigInt({
        tokenAddress: address,
        name: tokenRow?.name ?? detMeta?.name ?? null,
        symbol: tokenRow?.symbol ?? detMeta?.symbol ?? null,
        decimals: detDecimals,
        isContract: detIsContract,
        transferCount: detTransferCount,
        holderCount: detHolderCount,
        rawTotalSupply: detSupply !== null ? detSupply.toString() : null,
        totalSupply:
          detSupply !== null ? formatTokenAmount(detSupply, detDecimals) : null,
        logo: tokenRow?.logoUrl ? `/tokens/${address}/logo` : null,
      })
    );
  }

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
  const [transfers, cappedRows, meta, tokenRow] = await Promise.all([
    prisma.tokenTransfer.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM (
        SELECT 1 FROM "TokenTransfer" WHERE "tokenAddress" = ${address} LIMIT ${EXPLORER_LIST_CAP + 1}
      ) t
    `,
    getTokenMetadata(address, true),
    prisma.token.findUnique({ where: { address }, select: { decimals: true, transferCount: true } }),
  ]);
  const total = tokenRow?.transferCount ?? Number(cappedRows[0]?.count ?? 0);
  const decimals = meta?.decimals ?? tokenRow?.decimals ?? null;

  const partyAddresses = [
    ...new Set(transfers.flatMap((t) => [t.fromAddress, t.toAddress])),
  ];
  // Contract icons + verified names for From/To parties (shared helper).
  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: partyNameByAddr } =
    await resolveContractInfo(partyAddresses, false);

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
      fromIsToken: isTokenByAddr.get(t.fromAddress) ?? false,
      toIsToken: isTokenByAddr.get(t.toAddress) ?? false,
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

  const [meta, tokenRow] = await Promise.all([
    getTokenMetadata(address, true),
    prisma.token.findUnique({ where: { address }, select: { decimals: true } }),
  ]);
  const decimals = meta?.decimals ?? tokenRow?.decimals ?? null;

  // Prefer the indexer-maintained TokenBalance table (indexed by
  // [tokenAddress, balance]) for fast top-holder reads. Fall back to the
  // net-transfer-balance SQL below when balances aren't indexed yet.
  const balanceCount = await prisma.tokenBalance.count({
    where: { tokenAddress: address, balance: { gt: 0 }, ownerAddress: { not: ZERO } },
  });
  if (balanceCount > 0) {
    const [balances, balTokenRow, balRawSupply] = await Promise.all([
      prisma.tokenBalance.findMany({
        where: { tokenAddress: address, balance: { gt: 0 }, ownerAddress: { not: ZERO } },
        orderBy: { balance: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.token.findUnique({
        where: { address },
        select: { totalSupply: true },
      }),
      readTotalSupply(address),
    ]);
    const balTotalSupply =
      balRawSupply ??
      (balTokenRow?.totalSupply ? decimalToBigInt(balTokenRow.totalSupply) : null);
    const { isContract: balIsContract, isToken: balIsToken, names: balNames } =
      await resolveContractInfo(balances.map((b) => b.ownerAddress), false);
    const balRows = balances.map((b, i) => {
      const raw = decimalToBigInt(b.balance);
      let percentage: number | null = null;
      if (balTotalSupply && balTotalSupply > 0n) {
        percentage = Number((raw * 1000000n) / balTotalSupply) / 10000;
      }
      return {
        rank: offset + i + 1,
        address: b.ownerAddress,
        label: getAddressLabel(b.ownerAddress) ?? balNames.get(b.ownerAddress) ?? null,
        rawBalance: raw.toString(),
        balance: formatTokenAmount(raw, decimals),
        percentage,
        isContract: balIsContract.get(b.ownerAddress) ?? null,
        isToken: balIsToken.get(b.ownerAddress) ?? false,
      };
    });
    return res.json(
      serializeBigInt({
        tokenAddress: address,
        name: meta?.name ?? null,
        symbol: meta?.symbol ?? null,
        decimals,
        totalSupply: balTotalSupply !== null ? balTotalSupply.toString() : null,
        total: Math.min(balanceCount, EXPLORER_LIST_CAP),
        limit,
        offset,
        holders: balRows,
      })
    );
  }

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
  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: nameByAddr } =
    await resolveContractInfo(holders.map((h) => h.addr), false);

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
      isToken: isTokenByAddr.get(h.addr) ?? false,
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

/** Redis key the indexer publishes resolver health under. */
const METADATA_STATUS_KEY = "hoodscan:metadata:status";

/**
 * GET /tokens/metadata/status
 *
 * Operational view of the token-metadata resolver: how many Token rows the
 * indexer has seen, how many already have metadata, the remaining backlog,
 * and the resolver's live health (backoff level) as published to Redis by
 * the indexer process. Counts come straight from the DB (authoritative);
 * the resolver block is best-effort and null/`reporting:false` if the
 * indexer isn't currently publishing (stopped, or Redis unavailable).
 */
export async function getTokenMetadataStatus(_req: Request, res: Response) {
  const [totalTokens, withMetadata] = await Promise.all([
    prisma.token.count(),
    prisma.token.count({ where: { name: { not: null } } }),
  ]);
  const pendingBacklog = Math.max(totalTokens - withMetadata, 0);
  const coveragePct =
    totalTokens > 0
      ? Math.round((withMetadata / totalTokens) * 10000) / 100
      : 0;

  let backoffLevel: number | null = null;
  let lastUpdatedAt: string | null = null;
  let reporting = false;
  try {
    const raw = await redis.get(METADATA_STATUS_KEY);
    if (raw) {
      const snap = JSON.parse(raw) as {
        backoffLevel?: number;
        updatedAt?: string;
      };
      backoffLevel =
        typeof snap.backoffLevel === "number" ? snap.backoffLevel : null;
      lastUpdatedAt =
        typeof snap.updatedAt === "string" ? snap.updatedAt : null;
      reporting = true;
    }
  } catch (err) {
    console.error("[tokens] metadata status: Redis read failed:", err);
  }

  res.json({
    totalTokens,
    withMetadata,
    pendingBacklog,
    coveragePct,
    resolver: {
      // false => indexer not publishing (stopped, or Redis down/expired).
      reporting,
      // 0 = healthy, >0 = backing off (provider trouble), null = unknown.
      backoffLevel,
      degraded: (backoffLevel ?? 0) > 0,
      lastUpdatedAt,
    },
  });
}

/**
 * GET /tokens/:address/logo
 *
 * Image proxy for a token's logo. Reads the origin URL persisted in
 * Token.logoUrl (resolved from Blockscout) and streams the image bytes back
 * through our own domain, so the frontend never references the upstream
 * (Blockscout / CoinGecko) source directly. 404 => no logo on file; the UI
 * then renders its generated initials avatar. Best-effort: never throws.
 */
export async function getTokenLogo(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const row = await prisma.token.findUnique({
    where: { address },
    select: { logoUrl: true },
  });
  // null = unchecked, "" = checked/no icon — both mean 'no logo to serve'.
  const origin = row?.logoUrl;
  if (!origin) return res.status(404).end();

  try {
    const upstream = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
    if (!upstream.ok) return res.status(404).end();
    const contentType = upstream.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    return res.status(200).end(buf);
  } catch {
    return res.status(404).end();
  }
}
