"use client";

import { useEffect, useState } from "react";
import { ReadContractSection } from "@/components/ReadContractSection";
import { VerifyContractForm } from "@/components/VerifyContractForm";
import { WriteContractSection } from "@/components/WriteContractSection";
import { getVerification, type VerificationStatus } from "@/lib/api";
import { Callout } from "@/components/Callout";
import { Loading } from "@/components/Loading";

type SubTab = "code" | "read" | "write";

/**
 * Contract tab shell with Arbiscan-style sub-tabs.
 *
 * "Code" shows verification status: verified source + ABI + compiler
 * settings once verified (following proxies to their implementation),
 * otherwise the on-chain bytecode plus a form to verify. "Read"/"Write"
 * Contract use the verified/implementation ABI when available.
 */
export function ContractPanel({
  address,
  bytecode,
  sizeBytes,
}: {
  address: string;
  bytecode: string;
  sizeBytes: number;
}) {
  const [sub, setSub] = useState<SubTab>("code");
  const [verification, setVerification] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getVerification(address).then((res) => {
      if (alive) {
        setVerification(res);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [address]);

  const verified = verification?.verified === true;

  const subTabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-lime-bright text-black shadow-sm" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex w-fit rounded-xl border border-border bg-surface p-1">
          <button className={subTabClass(sub === "code")} onClick={() => setSub("code")}>
            Code
          </button>
          <button className={subTabClass(sub === "read")} onClick={() => setSub("read")}>
            Read Contract
          </button>
          <button className={subTabClass(sub === "write")} onClick={() => setSub("write")}>
            Write Contract
          </button>
        </div>
        {verified && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-lime/10 px-3 py-1 text-xs font-semibold text-lime">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
            Verified
          </span>
        )}
        {verified && verification?.proxyType && (
          <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
            Proxy
          </span>
        )}
      </div>

      {sub === "code" ? (
        <CodeTab
          address={address}
          bytecode={bytecode}
          sizeBytes={sizeBytes}
          loading={loading}
          verification={verification}
          onVerified={(rec) => {
            setVerification(rec);
            setSub("read");
          }}
        />
      ) : sub === "read" ? (
        <ReadContractSection address={address} />
      ) : (
        <WriteContractSection address={address} verification={verification} loading={loading} />
      )}
    </div>
  );
}

function CodeTab({
  address,
  bytecode,
  sizeBytes,
  loading,
  verification,
  onVerified,
}: {
  address: string;
  bytecode: string;
  sizeBytes: number;
  loading: boolean;
  verification: VerificationStatus | null;
  onVerified: (rec: VerificationStatus) => void;
}) {
  const verified = verification?.verified === true;

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <Loading label="Loading verification status…" />
      ) : verified ? (
        <VerifiedSource verification={verification!} />
      ) : (
        <>
          <Callout tone="warning">
            This contract&apos;s source isn&apos;t verified yet (not found on the explorer). Verify
            below to publish the source, unlock the real ABI, and enable full Read / Write Contract.
          </Callout>
          <VerifyContractForm address={address} onVerified={onVerified} />
        </>
      )}

      {/* Raw bytecode is always available regardless of verification. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Contract Bytecode
          </h2>
          <span className="font-mono text-xs text-muted">
            {sizeBytes.toLocaleString("en-US")} bytes
          </span>
        </div>
        <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-surface px-4 py-3 font-mono text-xs text-muted">
          {bytecode}
        </pre>
      </div>
    </div>
  );
}

function SourceBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
      <pre className="max-h-[28rem] overflow-auto rounded-xl border border-border bg-surface px-4 py-3 font-mono text-xs leading-relaxed text-ink">
        {code}
      </pre>
    </div>
  );
}

function VerifiedSource({ verification }: { verification: VerificationStatus }) {
  const impl = verification.implementation ?? null;
  const abiForDisplay = impl?.abi ?? verification.abi ?? [];
  const abiJson = JSON.stringify(abiForDisplay, null, 2);

  const meta: [string, string][] = [
    ["Contract name", verification.contractName ?? "—"],
    ["Compiler", verification.compilerVersion ?? "—"],
    [
      "Optimization",
      verification.optimizationEnabled
        ? `Yes, ${verification.optimizationRuns ?? 200} runs`
        : "No",
    ],
    ["EVM version", verification.evmVersion || "default"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="positive" className="text-sm text-ink">
        <span className="font-semibold text-lime">✓ Contract Source Code Verified</span> — matched
        against the on-chain bytecode.
      </Callout>

      {verification.proxyType && (
        <Callout tone="warning" className="text-sm text-ink">
          <span className="font-semibold text-warning">Proxy contract</span>
          {verification.proxyType ? ` (${verification.proxyType})` : ""}. Read &amp; Write operate on
          the implementation ABI.
          {impl && (
            <>
              {" "}
              Implementation:{" "}
              <a
                href={`/address/${impl.address}#code`}
                className="break-all font-mono text-lime hover:underline"
              >
                {impl.address}
              </a>
              {impl.contractName ? ` (${impl.contractName})` : ""}.
            </>
          )}
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {meta.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-surface px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-0.5 break-words font-mono text-xs text-ink">{value}</p>
          </div>
        ))}
      </div>

      <SourceBlock
        title={impl ? "Proxy Source Code" : "Source Code"}
        code={verification.sourceCode ?? ""}
      />

      {impl && (
        <SourceBlock
          title={`Implementation Source Code${impl.contractName ? ` — ${impl.contractName}` : ""}`}
          code={impl.sourceCode ?? ""}
        />
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {impl ? "Implementation ABI" : "Contract ABI"}
        </h2>
        <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-surface px-4 py-3 font-mono text-xs text-muted">
          {abiJson}
        </pre>
      </div>
    </div>
  );
}
