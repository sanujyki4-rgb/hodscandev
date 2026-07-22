import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { formatTokenAmount, decimalToBigInt } from "../utils/formatToken";
import { ADDRESS_RE } from "../utils/address";
import { getTokenMetadata } from "../utils/tokenResolver";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * GET /address/:address/token-holdings?limit=25&offset=0
 *
 * The ERC-20 portfolio (current holdings) for an address: every token the
 * address currently holds a positive balance of, ranked by raw balance.
 * Read straight from the indexer-maintained TokenBalance table (indexed by
 * [ownerAddress]) and joined against the persisted Token metadata — no live
 * on-chain calls, so the portfolio view stays fast.
 */
export async function listAddressTokenHoldings(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = { ownerAddress: address, balance: { gt: 0 } };
  const [balances, count] = await Promise.all([
    prisma.tokenBalance.findMany({
      where,
      orderBy: { balance: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.tokenBalance.count({ where }),
  ]);
  const total = Math.min(count, EXPLORER_LIST_CAP);

  // Distinct token contracts across the current page, joined to their
  // persisted metadata (name/symbol/decimals/logo). One Map lookup per row.
  const tokenAddresses = [...new Set(balances.map((b) => b.tokenAddress))];
  const tokens = await prisma.token.findMany({
    where: { address: { in: tokenAddresses } },
  });
  const tokenByAddress = new Map(tokens.map((t) => [t.address, t]));

  // Some tokens haven't had their metadata persisted yet (name/symbol/decimals
  // null in the Token table). Mirror the token detail view by resolving those
  // live from chain via getTokenMetadata — bounded + cached in Redis (30d),
  // best-effort — so the portfolio shows real names instead of "Unknown Token"
  // (and a resolved decimals lets the balance format correctly). Cached results
  // make later requests instant.
  const needsResolve = tokenAddresses.filter((a) => {
    const t = tokenByAddress.get(a);
    // Treat empty-string metadata as missing too (some Token rows store "").
    return !t || !t.name || !t.symbol || t.decimals === null;
  });
  const resolvedEntries = await Promise.all(
    needsResolve.map(async (a) => [a, await getTokenMetadata(a, true)] as const)
  );
  const resolvedByAddress = new Map(resolvedEntries);

  const holdings = balances.map((b) => {
    const token = tokenByAddress.get(b.tokenAddress);
    const fallback = resolvedByAddress.get(b.tokenAddress) ?? null;
    // Use || (not ??) for name/symbol so an empty-string DB value also falls
    // back to the live-resolved metadata. decimals keeps ?? (0 is valid).
    const name = token?.name || fallback?.name || null;
    const symbol = token?.symbol || fallback?.symbol || null;
    const decimals = token?.decimals ?? fallback?.decimals ?? null;
    const raw = decimalToBigInt(b.balance);
    return {
      tokenAddress: b.tokenAddress,
      name,
      symbol,
      decimals,
      rawBalance: raw.toString(),
      balance: formatTokenAmount(raw, decimals),
      logo: token?.logoUrl ? `/tokens/${b.tokenAddress}/logo` : null,
    };
  });

  res.json(serializeBigInt({ address, total, limit, offset, holdings }));
}
