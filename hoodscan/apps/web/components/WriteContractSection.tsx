"use client";

import { useState } from "react";
import {
  createWalletClient,
  custom,
  defineChain,
  parseEther,
  type Abi,
  type AbiFunction,
} from "viem";
import type { VerificationStatus } from "@/lib/api";

const CHAIN_ID = 4663;
const CHAIN_ID_HEX = "0x1237"; // 4663
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

/** Coerce a string form value into the JS type viem expects for a Solidity type. */
function coerceArg(value: string, type: string): unknown {
  const t = type.toLowerCase();
  if (t.endsWith("]") || t.startsWith("tuple")) {
    // arrays / tuples: expect JSON (e.g. [1,2] or ["0x..","0x.."]).
    return JSON.parse(value);
  }
  if (t.startsWith("uint") || t.startsWith("int")) return BigInt(value);
  if (t === "bool") return value === "true" || value === "1";
  return value;
}

function isWriteFn(item: unknown): item is AbiFunction {
  return (
    !!item &&
    typeof item === "object" &&
    (item as AbiFunction).type === "function" &&
    ((item as AbiFunction).stateMutability === "nonpayable" ||
      (item as AbiFunction).stateMutability === "payable")
  );
}

/** A single write function: arg inputs (+ optional payable value) and a Write button. */
function WriteFunctionCard({
  address,
  account,
  fn,
}: {
  address: string;
  account: string | null;
  fn: AbiFunction;
}) {
  const [args, setArgs] = useState<string[]>(() => (fn.inputs ?? []).map(() => ""));
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payable = fn.stateMutability === "payable";
  const signature = `${fn.name}(${(fn.inputs ?? []).map((i) => i.type).join(", ")})`;

  async function write() {
    if (!account || !window.ethereum) {
      setError("Connect a wallet first.");
      return;
    }
    setLoading(true);
    setError(null);
    setTxHash(null);
    try {
      const coerced = (fn.inputs ?? []).map((input, i) => coerceArg(args[i], input.type));
      const walletClient = createWalletClient({
        account: account as `0x${string}`,
        chain: robinhoodChain,
        transport: custom(window.ethereum),
      });
      const hash = await walletClient.writeContract({
        address: address as `0x${string}`,
        abi: [fn] as unknown as Abi,
        functionName: fn.name,
        args: coerced,
        value: payable && value ? parseEther(value) : undefined,
      });
      setTxHash(hash);
    } catch (err) {
      const message =
        err && typeof err === "object" && "shortMessage" in err
          ? String((err as { shortMessage: unknown }).shortMessage)
          : err instanceof Error
            ? err.message
            : "Transaction failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="font-mono text-sm font-semibold text-ink">{fn.name}</p>
      <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{signature}</p>

      <div className="mt-3 flex flex-col gap-2">
        {(fn.inputs ?? []).map((input, i) => (
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

        {payable && (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="value in ETH (payable)"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-base px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-lime"
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={write}
            disabled={loading || !account}
            className="rounded-lg bg-lime-bright px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-lime-bright-dark disabled:opacity-50"
          >
            {loading ? "Sending…" : "Write"}
          </button>
          {error && <span className="break-all font-mono text-xs text-danger">{error}</span>}
        </div>

        {txHash && (
          <div className="rounded-lg border border-border bg-base px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted">Transaction sent</p>
            <a
              href={`/tx/${txHash}`}
              className="break-all font-mono text-sm text-lime hover:underline"
            >
              {txHash}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function WriteContractSection({
  address,
  verification,
  loading,
}: {
  address: string;
  verification: VerificationStatus | null;
  loading: boolean;
}) {
  const [account, setAccount] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connect() {
    setConnectError(null);
    if (!window.ethereum) {
      setConnectError("No injected wallet found. Install MetaMask to write to contracts.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAccount(accounts?.[0] ?? null);

      // Ask the wallet to switch to Robinhood Chain; add it if unknown.
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_ID_HEX }],
        });
      } catch {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_ID_HEX,
                chainName: "Robinhood Chain",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [RPC_URL],
              },
            ],
          });
        } catch {
          /* user may already be on / declined the chain — best-effort */
        }
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to connect wallet");
    }
  }

  if (loading) {
    return <p className="px-1 py-6 text-sm text-muted">Loading verification status…</p>;
  }

  if (!verification?.verified) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-muted">
        Write Contract needs the contract&apos;s real ABI. Verify the source in the{" "}
        <span className="font-semibold text-ink">Code</span> tab first to enable writing.
      </div>
    );
  }

  // For proxies, write against the implementation ABI (Write as Proxy).
  const abiSource = verification.implementation?.abi ?? verification.abi ?? [];
  const writeFns = abiSource.filter(isWriteFn);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {verification.proxyType
            ? "State-changing functions from the implementation (Write as Proxy), sent from your wallet."
            : "State-changing functions, sent from your wallet via your own RPC node."}
        </p>
        {account ? (
          <span className="rounded-full bg-lime/10 px-3 py-1 font-mono text-xs font-semibold text-lime">
            {account.slice(0, 6)}…{account.slice(-4)}
          </span>
        ) : (
          <button
            onClick={connect}
            className="rounded-lg bg-lime-bright px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-lime-bright-dark"
          >
            Connect wallet
          </button>
        )}
      </div>

      {connectError && <p className="font-mono text-xs text-danger">{connectError}</p>}

      {writeFns.length === 0 ? (
        <p className="px-1 py-6 text-sm text-muted">
          This contract&apos;s ABI exposes no writable functions.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {writeFns.map((fn) => (
            <WriteFunctionCard key={fn.name} address={address} account={account} fn={fn} />
          ))}
        </div>
      )}
    </div>
  );
}
