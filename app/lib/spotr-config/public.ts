import { generatedPublicSpotrConfig } from "./public.generated";

export const publicSpotrConfig = generatedPublicSpotrConfig;


if (publicSpotrConfig.defaultSessionStartHourUtc >= publicSpotrConfig.defaultSessionEndHourUtc) {
  throw new Error(
    "NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_START_HOUR_UTC must be earlier than NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC"
  );
}
