import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { decodeAbiParameters } from "viem";
import { serializeBigInt } from "../utils/serialize";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * topic0 (event-signature hash) for the ERC-4337 EntryPoint's
 * `UserOperationEvent`. The signature is identical across EntryPoint v0.6 and
 * v0.7, so a single topic0 matches both:
 *   UserOperationEvent(bytes32 indexed userOpHash, address indexed sender,
 *     address indexed paymaster, uint256 nonce, bool success,
 *     uint256 actualGasCost, uint256 actualGasUsed)
 */
const USER_OPERATION_EVENT_TOPIC0 =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";

/** Canonical EntryPoint deployments (lowercased) → human version label. */
const ENTRY_POINTS: Record<string, string> = {
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789": "v0.6",
  "0x0000000071727de22e5e9d8baf0edac6f37da032": "v0.7",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Extract a 20-byte address from a 32-byte indexed topic (last 40 hex chars). */
function addressFromTopic(topic: string | null): string | null {
  if (!topic || topic.length < 40) return null;
  return ("0x" + topic.slice(-40)).toLowerCase();
}

/**
 * GET /transactions/:hash/user-operations
 *
 * Account Abstraction (ERC-4337) view for a transaction. Reads the already-
 * indexed EntryPoint `UserOperationEvent` logs from the Log table (no extra
 * RPC / no trace) and decodes each into a UserOperation summary: which account
 * (sender) ran, via which paymaster (if any), whether it succeeded, and the
 * gas it actually cost. A normal (non-AA) transaction simply has none of these
 * logs, so `userOperations` comes back empty and the UI hides the section.
 *
 * Always returns 200 with `{ txHash, total, userOperations }`; decoding is
 * best-effort and never throws the request.
 */
export async function listTransactionUserOperations(req: Request, res: Response) {
  const { hash } = req.params;
  if (!HASH_RE.test(hash)) {
    return res.status(400).json({ error: "Invalid transaction hash format" });
  }
  const txHash = hash.toLowerCase();

  try {
    const logs = await prisma.log.findMany({
      where: { txHash, topic0: USER_OPERATION_EVENT_TOPIC0 },
      orderBy: { logIndex: "asc" },
    });

    const userOperations = logs.map((log) => {
      const userOpHash = log.topic1 ?? null;
      const sender = addressFromTopic(log.topic2);
      const paymasterRaw = addressFromTopic(log.topic3);
      const paymaster =
        paymasterRaw && paymasterRaw !== ZERO_ADDRESS ? paymasterRaw : null;

      let nonce = "0";
      let success = false;
      let actualGasCost = "0";
      let actualGasUsed = "0";
      try {
        const [n, s, cost, used] = decodeAbiParameters(
          [
            { type: "uint256" },
            { type: "bool" },
            { type: "uint256" },
            { type: "uint256" },
          ],
          (log.data ?? "0x") as `0x${string}`
        );
        nonce = (n as bigint).toString();
        success = Boolean(s);
        actualGasCost = (cost as bigint).toString();
        actualGasUsed = (used as bigint).toString();
      } catch {
        /* leave defaults — malformed data must never break the endpoint */
      }

      const entryPoint = log.address.toLowerCase();
      return {
        userOpHash,
        sender,
        paymaster,
        nonce,
        success,
        actualGasCost,
        actualGasUsed,
        entryPoint,
        entryPointVersion: ENTRY_POINTS[entryPoint] ?? null,
        logIndex: log.logIndex,
      };
    });

    return res.json(
      serializeBigInt({ txHash, total: userOperations.length, userOperations })
    );
  } catch {
    // Never 500 the tx page over an AA lookup.
    return res.json({ txHash, total: 0, userOperations: [] });
  }
}
