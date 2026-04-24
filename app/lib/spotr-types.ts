export type SpotrCluster = "devnet" | "testnet" | "mainnet" | "localnet";

export type SpotrSide = "A" | "B";

export type SessionStatus = "pending" | "live" | "expired" | "completed";

export type SessionRoundStatus = "upcoming" | "open" | "closed" | "skipped";

export type RewardKind = "nft" | "merch" | "gift-card" | "voucher";

export type SpotrPublicConfig = {
  appName: string;
  seasonLabel: string;
  cluster: SpotrCluster;
  launchIso: string;
  sessionMinWallets: number;
  sessionMinTotalLamports: number;
  sessionBuyInLamports: number;
  roundMinStakeLamports: number;
  roundCount: number;
  roundDurationSeconds: number;
  protocolFeeBps: number;
  referralCutBps: number;
  defaultSessionStartHourUtc: number;
  defaultSessionEndHourUtc: number;
  lowPairAlertThreshold: number;
  payoutCadenceDays: number;
  minPaidSessionsForReferral: number;
  convictionHoldMs: number;
  cardRewardSlots: number;
  privyAppId: string;
};

export type FaultLinePair = {
  id: string;
  roundId: string;
  roundIndex: number;
  category: string;
  sideA: string;
  sideB: string;
  sideAPct: number;
  sideBPct: number;
  crowdLabel: string;
};

export type RewardInventoryItem = {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  status: "assigned" | "claimable" | "claimed";
};

export type ReferredWalletContribution = {
  walletAddress: string;
  totalEarnedLamports: number;
  paidOutLamports: number;
  balanceDueLamports: number;
};

export type SessionRoundSummary = {
  id: string;
  index: number;
  pairId: string;
  lockedSide?: SpotrSide;
  status: SessionRoundStatus;
  opensAtIso: string | null;
  closesAtIso: string | null;
  sideAProbabilityPct: number;
  sideBProbabilityPct: number;
  sideATotalEntries: number;
  sideBTotalEntries: number;
  stakeLamports: number | null;
  claimableLamports: number;
  claimedLamports: number;
};

export type LiveSessionSnapshot = {
  id: string;
  title: string;
  status: SessionStatus;
  walletsJoined: number;
  totalEscrowLamports: number;
  protocolFeeAccruedLamports: number;
  startsAtIso: string;
  endsAtIso: string;
  activatedAtIso: string | null;
  referralCutBps: number;
  rounds: SessionRoundSummary[];
  joined: boolean;
  remainingEscrowLamports: number | null;
  claimableSessionBalanceLamports: number;
  currentRoundId: string | null;
  currentRoundIndex: number | null;
  chainSessionNumber: string | null;
  chainSessionAddress: string | null;
};

export type ProfileSummary = {
  walletAddress: string;
  displayName: string | null;
  paidSessions: number;
  cumulativePnlLamports: number;
  referredWallets: number;
  referralPendingLamports: number;
  referralPaidOutLamports: number;
  claimableRoundLamports: number;
  claimableSessionBalanceLamports: number;
  referredWalletBreakdown: ReferredWalletContribution[];
  rewards: RewardInventoryItem[];
};

export type RecentTransaction = {
  id: string;
  kind: string;
  walletAddress: string | null;
  amountLamports: number | null;
  createdAtIso: string;
};

export type RecentReward = {
  id: string;
  walletAddress: string;
  title: string;
  status: "assigned" | "claimable" | "claimed";
  assignedAtIso: string;
};

export type AdminPairLibraryItem = {
  id: string;
  slug: string;
  category: string;
  sideA: string;
  sideB: string;
  active: boolean;
  assigned: boolean;
};

export type AdminSessionCard = {
  id: string;
  title: string;
  status: SessionStatus;
  startsAtIso: string;
  endsAtIso: string;
  walletsJoined: number;
  totalEscrowLamports: number;
  chainSessionNumber: string | null;
  chainSessionAddress: string | null;
  chainDeployTxSignature: string | null;
  createdAtIso: string;
};

export type AdminReferralBalance = {
  referrerWallet: string;
  referredWallets: number;
  totalAccruedLamports: number;
  paidOutLamports: number;
  balanceDueLamports: number;
};

export type AdminParticipant = {
  walletAddress: string;
  joinedAtIso: string;
  remainingEscrowLamports: number;
  referredByWallet: string | null;
  positionsEntered: number;
};

export type AdminSummary = {
  authorized: boolean;
  lowPairAlert: boolean;
  liveSessions: number;
  pendingSessions: number;
  activePairs: number;
  availablePairs: number;
  protocolFeesLamports: number;
  pendingReferralLamports: number;
  assignedRewards: number;
  claimableRewards: number;
  recentTransactions: RecentTransaction[];
  recentRewards: RecentReward[];
  participants: AdminParticipant[];
  pairLibrary: AdminPairLibraryItem[];
  sessionHistory: AdminSessionCard[];
  referralBalances: AdminReferralBalance[];
};

export type SpotrDashboardPayload = {
  session: LiveSessionSnapshot;
  faultLines: FaultLinePair[];
  profile: ProfileSummary | null;
  admin: AdminSummary;
};
