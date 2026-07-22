"use client";

import { useEffect, useState } from "react";
import {
  callContractRead,
  getReadContract,
  type ContractReadFunction,
  type ReadContractResponse,
} from "@/lib/api";
import { Callout } from "./Callout";
import { Loading } from "./Loading";

const STANDARD_LABEL: Record<string, string> = {
  erc20: "ERC-20",
  erc721: "ERC-721",
  erc1155: "ERC-1155",
  verified: "Verified ABI",
};

/** A single read function: eager value, or an input form + Query button. */
function FunctionCard({ address, fn }: { address: string; fn: ContractReadFunction }) {
  const [args, setArgs] = useState<string[]>(() => fn.inputs.map(() => ""));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signature = `${fn.name}(${fn.inputs.map((i) => i.type).join(", ")})`;
  const returnType = fn.outputs.map((o) => o.type).join(", ") || "void";

  async function query() {
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await callContractRead(address, fn.name, args);
    if (res.error) setError(res.error);
    else setResult(res.result ?? "");
    setLoading(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-ink">{fn.name}</p>
        <p className="font-mono text-[11px] text-muted">returns ({returnType})</p>
      </div>
      <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{signature}</p>

      {/* Zero-arg function: show its eagerly-resolved value. */}
      {!fn.hasInputs ? (
        <div className="mt-3 rounded-lg border border-border bg-base px-3 py-2">
          {fn.value !== null && fn.value !== "" ? (
            <p className="break-all font-mono text-sm text-lime">{fn.value}</p>
          ) : (
            <p className="font-mono text-sm text-muted">—</p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {fn.inputs.map((input, i) => (
            <input
              key={i}
              value={args[i]}
              onChange={(e) => {
                const next = [...args];
                next[i] = e.target.value;
                setArgs(next);
              }}
              placeholder={`${input.name || "arg" + i} (${input.type})`}
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-base px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-lime"
            />
          ))}
          <div className="flex items-center gap-3">
            <button
              onClick={query}
              disabled={loading}
              className="rounded-lg bg-lime-bright px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-lime-bright-dark disabled:opacity-50"
            >
              {loading ? "Querying…" : "Query"}
            </button>
            {error && <span className="font-mono text-xs text-danger">{error}</span>}
          </div>
          {result !== null && !error && (
            <div className="rounded-lg border border-border bg-base px-3 py-2">
              <p className="break-all font-mono text-sm text-lime">{result || "—"}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReadContractSection({ address }: { address: string }) {
  const [data, setData] = useState<ReadContractResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getReadContract(address).then((res) => {
      if (alive) {
        setData(res);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [address]);

  if (loading) {
    return <Loading label="Loading read functions…" />;
  }

  if (!data || !data.supported) {
    return (
      <Callout tone="warning">
        This contract doesn&apos;t match a known token standard (ERC-20/721/1155), so there&apos;s no
        standard read ABI to offer yet. Verified-source ABIs are a future phase.
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-lime/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-lime">
          {STANDARD_LABEL[data.standard ?? ""] ?? data.standard}
        </span>
        <p className="text-sm text-muted">
          {data.source === "verified"
            ? data.isProxy
              ? "Read functions from the proxy\u2019s implementation ABI (Read as Proxy), resolved live from your RPC node."
              : "Read functions from the verified ABI, resolved live from your RPC node."
            : "Standard read functions, resolved live from your RPC node."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.functions.map((fn) => (
          <FunctionCard key={fn.name} address={address} fn={fn} />
        ))}
      </div>
    </div>
  );
}
