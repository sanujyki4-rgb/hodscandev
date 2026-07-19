import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express handler so any rejected promise is forwarded
 * to next(), letting the central errorHandler middleware handle it.
 * Without this, a thrown error inside an async controller becomes an
 * unhandled rejection and Express never sends a response.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
