import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { SPOTR_MARKETS_PROGRAM_ADDRESS } from "../../generated/spotr/programs";

const ROUND_SEED = new Uint8Array([114, 111, 117, 110, 100]); // "round"

export async function findSpotrRoundPda(input: {
  session: Address;
  index: number;
  programAddress?: Address;
}): Promise<ProgramDerivedAddress> {
  if (!Number.isInteger(input.index) || input.index < 0 || input.index > 255) {
    throw new Error("round index must fit in a u8 (0-255).");
  }
  const programAddress = input.programAddress ?? SPOTR_MARKETS_PROGRAM_ADDRESS;
  return getProgramDerivedAddress({
    programAddress,
    seeds: [
      getBytesEncoder().encode(ROUND_SEED),
      getAddressEncoder().encode(input.session),
      new Uint8Array([input.index]),
    ],
  });
}
