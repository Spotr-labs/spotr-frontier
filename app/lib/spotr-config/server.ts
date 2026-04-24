import "server-only";

import { readCsvEnv } from "./shared";

export const serverSpotrConfig = {
  adminWallets: readCsvEnv("SPOTR_ADMIN_WALLETS"),
};
