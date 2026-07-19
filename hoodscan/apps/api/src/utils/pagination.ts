import type { Request } from "express";

/**
 * Parses `?limit=&offset=` off a request, shared by every list
 * endpoint (blocks, transactions, l1-to-l2, address, tokens, …) so the
 * clamping rules live in exactly one place. `limit` is clamped to
 * [.., maxLimit] and `offset` floored at 0.
 *
 * All list endpoints return a consistent { …, total, limit, offset }
 * envelope regardless of whether an offset was passed, so there is no
 * longer any "was offset explicitly passed" branching to support.
 */
export function parsePagination(
  req: Request,
  defaultLimit: number,
  maxLimit: number
): { limit: number; offset: number } {
  const limit = Math.min(Number(req.query.limit) || defaultLimit, maxLimit);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}
