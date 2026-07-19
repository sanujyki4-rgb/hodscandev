"use client";

import { useState } from "react";
import { submitVerification, type VerificationStatus } from "@/lib/api";

/**
 * Source-code verification form. Submits Solidity source + compiler
 * settings to the API, which compiles with the exact solc version and
 * matches the result against the on-chain bytecode. On success we hand
 * the verified record back up so the panel can switch to the verified
 * view immediately.
 */
export function VerifyContractForm({
  address,
  onVerified,
}: {
  address: string;
  onVerified: (record: VerificationStatus) => void;
}) {
  const [sourceCode, setSourceCode] = useState("");
  const [contractName, setContractName] = useState("");
  const [compilerVersion, setCompilerVersion] = useState("");
  const [optimizationEnabled, setOptimizationEnabled] = useState(false);
  const [optimizationRuns, setOptimizationRuns] = useState("200");
  const [evmVersion, setEvmVersion] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    sourceCode.trim() && contractName.trim() && compilerVersion.trim() && !submitting;

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await submitVerification(address, {
      sourceCode,
      contractName: contractName.trim(),
      compilerVersion: compilerVersion.trim(),
      optimizationEnabled,
      optimizationRuns: Number(optimizationRuns) || 200,
      evmVersion: evmVersion.trim() || undefined,
    });
    setSubmitting(false);
    if (res.verified) {
      onVerified(res);
    } else {
      setError(res.error ?? "Verification failed.");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-base px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-lime";
  const labelClass = "text-xs font-medium uppercase tracking-wide text-muted";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink">Verify &amp; publish source code</h3>
        <p className="text-sm text-muted">
          Paste the exact Solidity source. It&apos;s compiled with your chosen compiler and matched
          against the on-chain bytecode — all on your own node.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Contract name</label>
          <input
            value={contractName}
            onChange={(e) => setContractName(e.target.value)}
            placeholder="e.g. MyToken"
            spellCheck={false}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Compiler version</label>
          <input
            value={compilerVersion}
            onChange={(e) => setCompilerVersion(e.target.value)}
            placeholder="v0.8.24+commit.e11b9ed9"
            spellCheck={false}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Optimization</label>
          <div className="flex items-center gap-4 py-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={optimizationEnabled}
                onChange={(e) => setOptimizationEnabled(e.target.checked)}
                className="h-4 w-4 accent-lime"
              />
              Enabled
            </label>
            <input
              value={optimizationRuns}
              onChange={(e) => setOptimizationRuns(e.target.value.replace(/[^0-9]/g, ""))}
              disabled={!optimizationEnabled}
              placeholder="runs (200)"
              className={`${inputClass} max-w-32 disabled:opacity-50`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>EVM version (optional)</label>
          <input
            value={evmVersion}
            onChange={(e) => setEvmVersion(e.target.value)}
            placeholder="default / paris / shanghai / cancun"
            spellCheck={false}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Solidity source code (flattened)</label>
        <textarea
          value={sourceCode}
          onChange={(e) => setSourceCode(e.target.value)}
          placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.24;&#10;&#10;contract MyToken { ... }"
          spellCheck={false}
          rows={14}
          className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
        />
        <p className="text-[11px] text-muted">
          Multi-file contracts must be flattened into a single file. Contracts using constructor
          arguments or immutables may not match with the current verifier.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-lg bg-lime-bright px-4 py-2 text-sm font-semibold text-black transition hover:bg-lime-bright-dark disabled:opacity-50"
        >
          {submitting ? "Compiling & matching…" : "Verify & publish"}
        </button>
        {error && (
          <span className="max-w-full break-words font-mono text-xs text-danger">{error}</span>
        )}
      </div>
    </div>
  );
}
