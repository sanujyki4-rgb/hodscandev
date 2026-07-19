"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
  description: string;
}

const LINKS: NavLink[] = [
  { href: "/blocks", label: "Blocks", description: "Browse all indexed blocks" },
  { href: "/transactions", label: "Transactions", description: "Browse all transactions" },
  { href: "/tokens", label: "Tokens", description: "ERC-20 tokens by activity" },
  {
    href: "/transactions/l1-to-l2",
    label: "L1↔L2 Messages",
    description: "Arbitrum-style sync transactions",
  },
];

export function NavDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const isActive = LINKS.some((l) => pathname.startsWith(l.href));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium transition ${
          isActive || open ? "text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Blockchain
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-2 transition hover:bg-lime-bright/10"
            >
              <span className="text-sm font-medium text-ink">{link.label}</span>
              <span className="text-xs text-muted">{link.description}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
