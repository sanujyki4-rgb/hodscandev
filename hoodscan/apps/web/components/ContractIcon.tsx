"use client";

import { useState } from "react";
import { addressLogoSrc } from "@/lib/api";

/**
 * Inline glyph shown next to a smart-contract address (Etherscan/Arbiscan
 * style). When the address is a TOKEN contract (`isToken`), we show its logo
 * via our own /tokens/:address/logo proxy (origin stays hidden); if that token
 * has no logo on file the proxy 404s and we fall back to the generic contract
 * glyph. Non-token contracts always render the generic glyph. EOAs render
 * nothing (callers gate on isContract).
 */
export function ContractIcon({
  title = "Contract",
  address,
  isToken,
  size = 14,
}: {
  title?: string;
  address?: string | null;
  isToken?: boolean | null;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const src = isToken && address ? addressLogoSrc(address) : null;

  if (src && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={title}
        title={title}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        style={{ width: size, height: size, borderRadius: "9999px", objectFit: "cover" }}
        className="inline-block shrink-0 bg-surface"
      />
    );
  }

  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 items-center text-muted"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M4 1.75h4.5L12.5 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M8.25 1.75V5.5h4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="m6.4 8.6-1.3 1.3 1.3 1.3M9.1 8.6l1.3 1.3-1.3 1.3"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
