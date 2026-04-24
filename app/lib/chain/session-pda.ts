import {
  getBytesEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { SPOTR_MARKETS_PROGRAM_ADDRESS } from "../../generated/spotr/programs";

const SESSION_SEED = new Uint8Array([115, 101, 115, 115, 105, 111, 110]); // "session"

export async function findSpotrSessionPda(
  sessionNumber: bigint,
  programAddress: Address = SPOTR_MARKETS_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [
      getBytesEncoder().encode(SESSION_SEED),
      getU64Encoder().encode(sessionNumber),
    ],
  });
}
