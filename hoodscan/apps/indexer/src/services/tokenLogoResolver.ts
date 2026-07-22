import { BLOCK_EXPLORER_URL } from "@hoodscan/config";

/**
 * Resolve a token's logo from the chain's official Blockscout explorer
 * (GET /api/v2/tokens/{address}, `icon_url` field), mirroring how
 * blockscoutVerification.ts already reuses Blockscout for verified ABIs.
 *
 * We persist only the resolved origin URL into Token.logoUrl; the image itself
 * is later streamed through our own API proxy so the frontend never references
 * Blockscout/CoinGecko directly.
 *
 * Return contract (drives the "checked vs unchecked" state in the DB):
 *   - non-empty string -> the token's icon URL
 *   - ""               -> Blockscout answered but the token has no icon
 *                         (mark as checked so we don't keep re-fetching)
 *   - null             -> transient failure (network/timeout/parse); leave the
 *                         row unchecked so a later pass retries it
 *
 * Best-effort: never throws.
 */
interface BlockscoutTokenResponse {
  icon_url?: string | null;
}

export async function fetchTokenLogoUrl(address: string): Promise<string | null> {
  const base = BLOCK_EXPLORER_URL.replace(/\/+$/, "");
  const url = `${base}/api/v2/tokens/${address.toLowerCase()}`;

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return ""; // known-absent on Blockscout -> checked
    if (!res.ok) return null; // 5xx / rate-limited -> retry later
    const data = (await res.json()) as BlockscoutTokenResponse;
    const icon = typeof data.icon_url === "string" ? data.icon_url.trim() : "";
    return icon; // url, or "" when present-but-no-icon
  } catch {
    return null; // network / timeout / bad JSON -> retry later
  }
}
