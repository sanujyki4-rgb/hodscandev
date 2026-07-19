import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { verifyContractSource } from "../utils/verifyContract";
import { resolveContract } from "../utils/verifiedAbi";

import { ADDRESS_RE } from "../utils/address";

/**
 * GET /address/:address/verification
 *
 * Reports whether a contract's source is verified (via our DB or the
 * chain's Blockscout explorer). For proxies it also returns the resolved
 * implementation (address, name, source, ABI) so the UI can show the
 * implementation source and drive Read/Write as Proxy.
 */
export async function getVerification(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const resolved = await resolveContract(address);
  if (!resolved) {
    return res.json({ address, verified: false });
  }

  const { record, implementation } = resolved;

  return res.json(
    serializeBigInt({
      address,
      verified: true,
      contractName: record.contractName,
      compilerVersion: record.compilerVersion,
      optimizationEnabled: record.optimizationEnabled,
      optimizationRuns: record.optimizationRuns,
      evmVersion: record.evmVersion,
      sourceCode: record.sourceCode,
      abi: record.abi,
      constructorArguments: record.constructorArguments,
      proxyType: record.proxyType,
      verifiedAt: record.verifiedAt,
      implementation: implementation
        ? {
            address: implementation.address,
            contractName: implementation.contractName,
            compilerVersion: implementation.compilerVersion,
            sourceCode: implementation.sourceCode,
            abi: implementation.abi,
          }
        : null,
    })
  );
}

/**
 * POST /address/:address/verify
 * Body: { sourceCode, contractName, compilerVersion, optimizationEnabled,
 *         optimizationRuns, evmVersion?, constructorArguments? }
 *
 * Compiles the submitted source with the exact solc version and compares
 * the result against the on-chain runtime bytecode. On a match it stores
 * the verified source + ABI and returns verified:true. Compiler errors
 * and bytecode mismatches come back as 200 { verified:false, error } so
 * the UI can show them inline instead of failing hard.
 */
export async function postVerify(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const sourceCode = typeof req.body?.sourceCode === "string" ? req.body.sourceCode : "";
  const contractName = typeof req.body?.contractName === "string" ? req.body.contractName.trim() : "";
  const compilerVersion =
    typeof req.body?.compilerVersion === "string" ? req.body.compilerVersion.trim() : "";
  const optimizationEnabled = Boolean(req.body?.optimizationEnabled);
  const optimizationRunsRaw = Number(req.body?.optimizationRuns);
  const optimizationRuns = Number.isFinite(optimizationRunsRaw) ? optimizationRunsRaw : 200;
  const evmVersion =
    typeof req.body?.evmVersion === "string" && req.body.evmVersion.trim()
      ? req.body.evmVersion.trim()
      : undefined;
  const constructorArguments =
    typeof req.body?.constructorArguments === "string" && req.body.constructorArguments.trim()
      ? req.body.constructorArguments.trim()
      : null;

  if (!sourceCode || !contractName || !compilerVersion) {
    return res.status(400).json({
      error: "sourceCode, contractName, and compilerVersion are required",
    });
  }

  let result;
  try {
    result = await verifyContractSource({
      address,
      sourceCode,
      contractName,
      compilerVersion,
      optimizationEnabled,
      optimizationRuns,
      evmVersion,
    });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Compilation failed";
    return res.status(200).json({ address, verified: false, error: message });
  }

  if (!result.matched) {
    return res.status(200).json({
      address,
      verified: false,
      error:
        "Compiled bytecode does not match the on-chain bytecode. Check the compiler version, optimization settings, EVM version, and that this is the exact deployed source.",
    });
  }

  const abiString = JSON.stringify(result.abi);
  const data = {
    contractName,
    compilerVersion,
    optimizationEnabled,
    optimizationRuns,
    evmVersion: evmVersion ?? null,
    sourceCode,
    abi: abiString,
    constructorArguments,
  };
  const record = await prisma.verifiedContract.upsert({
    where: { address },
    create: { address, ...data },
    update: data,
  });

  return res.json(
    serializeBigInt({
      address,
      verified: true,
      contractName: record.contractName,
      compilerVersion: record.compilerVersion,
      optimizationEnabled: record.optimizationEnabled,
      optimizationRuns: record.optimizationRuns,
      evmVersion: record.evmVersion,
      sourceCode: record.sourceCode,
      abi: result.abi,
      constructorArguments: record.constructorArguments,
      proxyType: record.proxyType,
      verifiedAt: record.verifiedAt,
      implementation: null,
    })
  );
}
