import { generatedPublicSpotrConfig } from "./public.generated";

export const publicSpotrConfig = generatedPublicSpotrConfig;

if (publicSpotrConfig.roundMinStakeLamports > publicSpotrConfig.sessionBuyInLamports) {
  throw new Error(
    "NEXT_PUBLIC_SPOTR_ROUND_MIN_STAKE_LAMPORTS must be less than or equal to NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS"
  );
}

if (publicSpotrConfig.defaultSessionStartHourUtc >= publicSpotrConfig.defaultSessionEndHourUtc) {
  throw new Error(
    "NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_START_HOUR_UTC must be earlier than NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC"
  );
}
