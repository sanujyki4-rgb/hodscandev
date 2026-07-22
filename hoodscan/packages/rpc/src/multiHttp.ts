import {
  fallback,
  http,
  type HttpTransportConfig,
  type Transport,
} from "viem";

/**
 * Multi-URL HTTP transport for viem.
 *
 * Uses viem's built-in `fallback` so typing stays correct across viem
 * versions. Concurrent requests still fan out: each inner `http`
 * transport is independent, and `rank: true` prefers healthier/faster
 * endpoints (typical when several keys share load).
 *
 * On failure of the current primary, the next URL is tried automatically.
 * Single-URL lists degrade to plain `http(url)`.
 *
 * Order of `urls` is the initial preference order (first = preferred).
 */
export function multiHttp(
  urls: string[],
  config: HttpTransportConfig = {}
): Transport {
  if (urls.length === 0) {
    throw new Error("multiHttp: at least one RPC URL is required");
  }

  if (urls.length === 1) {
    return http(urls[0], config);
  }

  // Per-URL retries stay low — fallback handles switching endpoints.
  const perUrl: HttpTransportConfig = {
    ...config,
    retryCount: config.retryCount ?? 0,
  };

  return fallback(
    urls.map((url) => http(url, perUrl)),
    {
      // Prefer the lowest-latency / healthiest endpoint over time.
      rank: true,
      // Don't stack another full retry loop on top of per-URL retries.
      retryCount: urls.length > 1 ? 1 : 0,
    }
  );
}
