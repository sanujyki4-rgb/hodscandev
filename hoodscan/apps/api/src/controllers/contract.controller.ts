import type { Request, Response } from "express";
import { isValidAddress } from "../utils/address";
import { getContractBytecode } from "../utils/isContract";

/**
 * GET /address/:address/contract
 *
 * Returns the on-chain bytecode for an address, powering the address
 * page's "Contract" tab. Source-code verification (Code / Read / Write)
 * is a separate future subsystem; for now we expose what the chain gives
 * us directly: the raw runtime bytecode and its size.
 *
 * EIP-7702 note: a delegated EOA's code is a 23-byte 0xef0100‖address
 * designator — we treat that as NOT a contract (it is still a wallet).
 */
const EIP7702_PREFIX = "0xef0100";

export async function getAddressContract(req: Request, res: Response) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const bytecode = await getContractBytecode(address);
  const normalized = bytecode.toLowerCase();
  const isContract =
    normalized.length > 2 &&
    normalized !== "0x" &&
    !normalized.startsWith(EIP7702_PREFIX);
  const sizeBytes = isContract ? Math.max((bytecode.length - 2) / 2, 0) : 0;

  res.json({ address, isContract, bytecode, sizeBytes });
}
