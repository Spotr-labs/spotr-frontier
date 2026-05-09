export function getJoinChainPersistence(input: {
  chainTxSignature: string;
  playerSessionAddress: string;
}) {
  return {
    chainJoinTxSignature:
      input.chainTxSignature === "already-joined" ? null : input.chainTxSignature,
    chainPlayerSessionAddress: input.playerSessionAddress,
  };
}
