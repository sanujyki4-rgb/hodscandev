import type { Request, Response, NextFunction } from "express";

/**
 * Central Express error-handling middleware. Must be registered LAST
 * (after routes and the 404 handler). Any error thrown inside an async
 * controller reaches here via the asyncHandler wrapper, so a failing
 * Prisma query (or anything else) returns a clean 500 instead of
 * leaking a stack trace or hanging the request.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  console.error("[api] Unhandled error:", err);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}
