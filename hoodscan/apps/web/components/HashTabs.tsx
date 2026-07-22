"use client";

import { useEffect, useId, type ReactNode } from "react";

export type HashTab = {
  /** Stable id (used as React key). */
  id: string;
  /** URL hash slug, Arbiscan-style. The URL becomes /address/0x..#<hash>. */
  hash: string;
  label: string;
  /** Optional trailing node next to the label (e.g. a verified ✓). */
  badge?: ReactNode;
  content: ReactNode;
};

/**
 * Client-side, hash-driven tab strip (Arbiscan-style URLs like
 * /address/0x..#events).
 *
 * The active tab lives in the URL fragment. To avoid the "flash of the first
 * tab" on refresh / deep-link (the fragment is NOT available during SSR, so the
 * server can only ever render the first tab), which panel is visible and which
 * tab is highlighted are driven entirely by CSS, keyed off a `data-htab-*`
 * attribute on <html>. A tiny inline script sets that attribute from
 * location.hash BEFORE the browser paints, so the correct tab is shown on the
 * very first frame. React's effect then only keeps the attribute in sync when
 * the user switches tabs (hashchange).
 *
 * The tab links are plain `#hash` fragments, but NO element carries that id, so
 * clicking a tab never scroll-jumps the page — it just updates the hash and the
 * CSS swaps the panel.
 */
export function HashTabs({ tabs }: { tabs: HashTab[] }) {
  // useId is stable across SSR + client, so the generated CSS/markup match on
  // hydration. Strip characters that aren't valid in a CSS/attr identifier.
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const attr = `data-htab-${scope}`;
  const panelClass = `htp-${scope}`;
  const tabClass = `htt-${scope}`;

  const firstHash = tabs[0]?.hash ?? "";
  const activeCss = "border-color:rgb(var(--color-lime));color:rgb(var(--color-ink))";
  const showCss = "display:flex;flex-direction:column;gap:1rem";

  const rules: string[] = [`.${panelClass}{display:none}`];
  for (const t of tabs) {
    rules.push(
      `html[${attr}="${t.hash}"] .${panelClass}[data-panel="${t.hash}"]{${showCss}}`
    );
    rules.push(
      `html[${attr}="${t.hash}"] .${tabClass}[data-tab="${t.hash}"]{${activeCss}}`
    );
  }
  // Before the script runs (or with JS disabled): default to the first tab.
  rules.push(
    `html:not([${attr}]) .${panelClass}[data-panel="${firstHash}"]{${showCss}}`
  );
  rules.push(
    `html:not([${attr}]) .${tabClass}[data-tab="${firstHash}"]{${activeCss}}`
  );
  const css = rules.join("\n");

  const validHashes = JSON.stringify(tabs.map((t) => t.hash));
  const initScript =
    `(function(){try{var v=${validHashes};` +
    `var h=(location.hash||"").replace(/^#/,"");` +
    `document.documentElement.setAttribute(${JSON.stringify(attr)},` +
    `v.indexOf(h)>=0?h:${JSON.stringify(firstHash)});}catch(e){}})();`;

  useEffect(() => {
    const el = document.documentElement;
    const valid = tabs.map((t) => t.hash);
    const apply = () => {
      const h = window.location.hash.replace(/^#/, "");
      el.setAttribute(attr, valid.includes(h) ? h : firstHash);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [tabs, attr, firstHash]);

  return (
    <div className="flex flex-col gap-4">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {/* Pre-paint: choose the tab from the URL fragment before the first paint. */}
      <script dangerouslySetInnerHTML={{ __html: initScript }} />

      <div className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#${t.hash}`}
            data-tab={t.hash}
            className={`${tabClass} -mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted transition hover:text-ink`}
          >
            {t.label}
            {t.badge}
          </a>
        ))}
      </div>

      <div>
        {tabs.map((t) => (
          <div key={t.id} data-panel={t.hash} className={panelClass}>
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
