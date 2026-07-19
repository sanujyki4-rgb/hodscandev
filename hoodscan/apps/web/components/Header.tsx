import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { NavDropdown } from "./NavDropdown";
import { HeaderSearch } from "./HeaderSearch";
import { ThemeToggle } from "./ThemeToggle";
import { MobileNav } from "./MobileNav";
import { getLatestBlocks } from "@/lib/api";

const MOBILE_NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/blocks", label: "Blocks" },
  { href: "/transactions", label: "Transactions" },
  { href: "/tokens", label: "Tokens" },
  { href: "/transactions/l1-to-l2", label: "L1↔L2 Messages" },
  { href: "/stats", label: "Stats" },
];

/**
 * Site header. Server component — fetches the latest block itself for
 * the live badge, independent of whatever a given page also fetches.
 * Genuinely interactive pieces (search, nav dropdown, theme toggle,
 * mobile menu) are their own client components underneath.
 *
 * Layout is 3 groups spread with justify-between, on purpose: brand
 * stays isolated on the far left, nav+search form their own cluster
 * with breathing room, and status/actions sit on the far right.
 */
export async function Header() {
  const blocks = await getLatestBlocks(1);
  const latestBlock = blocks?.[0] ?? null;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-base/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-6 px-8 sm:px-12 lg:px-20">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <LogoMark />
          <span className="text-[17px] font-bold tracking-tight">
            hood<span className="text-lime">scan</span>
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-center gap-1">
          <HomeLink />
          <NavDropdown />
          <Link
            href="/stats"
            className="hidden rounded-lg px-3 py-1 text-sm font-medium text-muted transition hover:text-ink md:block"
          >
            Stats
          </Link>
          <div className="ml-3">
            <HeaderSearch />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {latestBlock && (
            <Link
              href={`/block/${latestBlock.number}`}
              className="hidden items-center gap-2 rounded-full border border-border bg-surface py-1 pl-2.5 pr-3 transition hover:border-lime/50 sm:flex"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-lime-bright" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-bright" />
              </span>
              <span className="font-mono text-[11px] font-medium text-ink">
                #{latestBlock.number}
              </span>
            </Link>
          )}

          <span className="hidden rounded-full border border-border bg-surface px-3 py-1 font-mono text-[11px] text-muted lg:inline-block">
            Chain 4663
          </span>

          <ThemeToggle />
          <MobileNav links={MOBILE_NAV_LINKS} />
        </div>
      </div>
    </header>
  );
}

function HomeLink() {
  return (
    <Link
      href="/"
      className="hidden rounded-lg px-3 py-1 text-sm font-medium text-muted transition hover:text-ink md:block"
    >
      Home
    </Link>
  );
}
