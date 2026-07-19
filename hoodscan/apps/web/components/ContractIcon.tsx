/**
 * Small inline "contract" glyph shown next to an address that has
 * deployed bytecode (Etherscan/Arbiscan style). Rendered only when the
 * address is known to be a smart contract; wallets (EOAs) show nothing.
 */
export function ContractIcon({ title = "Contract" }: { title?: string }) {
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
