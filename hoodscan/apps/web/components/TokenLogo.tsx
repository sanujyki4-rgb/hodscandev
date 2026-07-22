"use client";

import { useState } from "react";

/**
 * Token logo with a graceful fallback.
 *
 * Robinhood Chain uses its OWN contract addresses, so public token lists
 * (Trust Wallet / Uniswap) won't match by address. We therefore:
 *   1. look up a curated address -> logo URL map (TOKEN_LOGOS), then
 *   2. fall back to the Hoodscan brand mark (/hoodscan-mark.svg) — used for any
 *      token that has no submitted logo.
 *
 * Add real logos by dropping lowercased-address -> URL entries into TOKEN_LOGOS
 * (or by passing an explicit `logoUrl` prop once the API serves one).
 */
const TOKEN_LOGOS: Record<string, string> = {
  // Example (uncomment + point at a real asset to override the fallback):
  // "0x0bd7d308f8e1639fab988df18a8011f41eacad73": "/logos/weth.svg",
};

export function TokenLogo({
  address,
  symbol,
  logoUrl,
  size = 20,
}: {
  address: string;
  symbol?: string | null;
  logoUrl?: string | null;
  size?: number;
}) {
  const src = logoUrl ?? TOKEN_LOGOS[address.toLowerCase()] ?? null;
  const [errored, setErrored] = useState(false);

  const dimension = { width: size, height: size, minWidth: size };

  if (src && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={symbol ? `${symbol} logo` : "token logo"}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        style={{ ...dimension, borderRadius: "9999px", objectFit: "cover" }}
        className="inline-block shrink-0 bg-surface"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/hoodscan-mark.svg"
      alt={symbol ? `${symbol} logo` : "token logo"}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, minWidth: size, borderRadius: "9999px" }}
      className="inline-block shrink-0"
    />
  );
}
