import "server-only";

import { readCsvEnv } from "./shared";
import { readAutoFillBotsConfig } from "../server/auto-fill-bots.shared";

export const serverSpotrConfig = {
  adminWallets: readCsvEnv("SPOTR_ADMIN_WALLETS"),
  autoFillBots: readAutoFillBotsConfig(),
};
