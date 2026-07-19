import type { Request, Response } from "express";
import type { Abi, AbiFunction } from "viem";
import { serializeBigInt } from "../utils/serialize";
import {
  READ_ABIS,
  readRpcClient,
  detectReadStandard,
  findReadFunction,
  coerceArg,
  displayReadResult,
} from "../utils/standardReadAbi";
import { resolveContract, splitAbi } from "../utils/verifiedAbi";

import { ADDRESS_RE } from "../utils/address";

/** Shape returned for a single read function in the list response. */
interface ReadFunctionResponse {
  name: string;
  stateMutability: string;
  inputs: { name: string; type: string }[];
  outputs: { type: string }[];
  hasInputs: boolean;
  value: string | null;
}

/**
 * Turn a viem AbiFunction into the UI-facing shape, eagerly resolving
 * zero-argument reads against the RPC node (best-effort: a revert yields
 * null). Shared by the verified-ABI and standard-ABI paths.
 */
async function resolveReadFunction(
  address: string,
  fn: AbiFunction
): Promise<ReadFunctionResponse> {
  const inputs = (fn.inputs ?? []).map((i) => ({ name: i.name ?? "", type: i.type }));
  const outputs = (fn.outputs ?? []).map((o) => ({ type: o.type }));
  const hasInputs = inputs.length > 0;

  let value: string | null = null;
  if (!hasInputs) {
    try {
      const result = await readRpcClient.readContract({
        address: address as `0x${string}`,
        abi: [fn] as unknown as Abi,
        functionName: fn.name,
      });
      value = displayReadResult(result);
    } catch {
      value = null;
    }
  }

  return { name: fn.name, stateMutability: fn.stateMutability, inputs, outputs, hasInputs, value };
}

/**
 * GET /address/:address/read-contract
 *
 * Prefers a contract's *verified* ABI when available — following a proxy
 * to its implementation ABI (Read as Proxy). Falls back to the standard
 * ERC fragments (ERC-20/721/1155) when the contract isn't verified but
 * its token standard is detectable. Otherwise supported:false.
 */
export async function getReadContract(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  // 1. Verified ABI wins — effective ABI already follows proxies.
  const resolved = await resolveContract(address);
  if (resolved) {
    const { reads } = splitAbi(resolved.effectiveAbi);
    const functions = await Promise.all(reads.map((fn) => resolveReadFunction(address, fn)));
    return res.json(
      serializeBigInt({
        address,
        standard: "verified",
        source: "verified",
        supported: true,
        isProxy: Boolean(resolved.record.proxyType),
        functions,
      })
    );
  }

  // 2. Fall back to standard token ABI by detected standard.
  const standard = await detectReadStandard(address);
  if (!standard) {
    return res.json({
      address,
      standard: null,
      source: "standard",
      supported: false,
      functions: [],
    });
  }

  const abi = READ_ABIS[standard];
  const functions = await Promise.all(abi.map((fn) => resolveReadFunction(address, fn)));

  res.json(serializeBigInt({ address, standard, source: "standard", supported: true, functions }));
}

/**
 * POST /address/:address/read-contract
 * Body: { functionName: string, args: string[] }
 *
 * Executes a single read function with user-supplied arguments against
 * the user's RPC node. Uses the verified (proxy-resolved) ABI when
 * available, otherwise the standard fragment. A revert / bad argument
 * returns 200 with an { error } so the UI can show it inline.
 */
export async function callReadContract(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const functionName = typeof req.body?.functionName === "string" ? req.body.functionName : "";
  const rawArgs: unknown = req.body?.args;
  const args = Array.isArray(rawArgs) ? rawArgs.map((a) => String(a)) : [];

  if (!functionName) {
    return res.status(400).json({ error: "functionName is required" });
  }

  // Resolve the function fragment from the verified (proxy-aware) ABI
  // first, else the standard token ABI.
  let fn: AbiFunction | undefined;
  const resolved = await resolveContract(address);
  if (resolved) {
    const { reads } = splitAbi(resolved.effectiveAbi);
    fn = reads.find((f) => f.name === functionName);
  } else {
    const standard = await detectReadStandard(address);
    if (!standard) {
      return res.status(400).json({ error: "No read ABI available for this contract" });
    }
    fn = findReadFunction(standard, functionName);
  }

  if (!fn) {
    return res.status(400).json({ error: `Unknown read function "${functionName}"` });
  }

  const inputs = fn.inputs ?? [];
  if (args.length !== inputs.length) {
    return res
      .status(400)
      .json({ error: `Expected ${inputs.length} argument(s), got ${args.length}` });
  }

  let coerced: unknown[];
  try {
    coerced = inputs.map((input, i) => coerceArg(args[i], input.type));
  } catch {
    return res.status(200).json({ error: "Invalid argument value for the expected type" });
  }

  try {
    const result = await readRpcClient.readContract({
      address: address as `0x${string}`,
      abi: [fn] as unknown as Abi,
      functionName: fn.name,
      args: coerced,
    });
    return res.json({ result: displayReadResult(result) });
  } catch (err) {
    const message =
      err && typeof err === "object" && "shortMessage" in err
        ? String((err as { shortMessage: unknown }).shortMessage)
        : "Call reverted or failed";
    return res.json({ error: message });
  }
}
