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
  sessionBuyInLamports: number;
  roundCount: number;
  roundDurationSeconds: number;
  roundFillThreshold: number;
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
  // Wait-phase fields. `walletsDepositedForRound` mirrors the on-chain
  // Round.deposits_count; `depositLamports` is the connected wallet's own
  // RoundDeposit.amount_usdc_units (null if they haven't deposited yet).
  walletsDepositedForRound: number;
  depositorAddresses: string[];
  depositLamports: number | null;
  depositRefunded: boolean;
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
  participant: { joinedAtIso: string } | null;
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
  buyInLamports: number;
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
  nextSessionsCursor: AdminCursor;
  referralBalances: AdminReferralBalance[];
};

export type SpotrDashboardPayload = {
  session: LiveSessionSnapshot;
  faultLines: FaultLinePair[];
  profile: ProfileSummary | null;
  admin: AdminSummary;
  // Pending + live sessions visible to anyone (drives the /play browse list).
  availableSessions: AdminSessionCard[];
};

export type SessionRoundResult = {
  index: number;
  status: SessionRoundStatus;
  category: string;
  sideA: string;
  sideB: string;
  sideAPct: number;
  sideBPct: number;
  sideATotalEntries: number;
  sideBTotalEntries: number;
  totalVolumeLamports: number;
  winningSide: SpotrSide | null;
};

export type SessionPublicResults = {
  id: string;
  title: string;
  status: SessionStatus;
  startsAtIso: string;
  endsAtIso: string;
  walletsJoined: number;
  totalEscrowLamports: number;
  rounds: SessionRoundResult[];
};

export type ProfileSessionHistoryRow = {
  sessionId: string;
  title: string;
  status: SessionStatus;
  joinedAtIso: string;
  startsAtIso: string;
  endsAtIso: string;
  positionsEntered: number;
  netPnlLamports: number;
};

export type ProfileSessionHistoryResponse = {
  items: ProfileSessionHistoryRow[];
};

export type ProfileSessionRoundRow = {
  roundId: string;
  roundIndex: number;
  pairCategory: string;
  sideA: string;
  sideB: string;
  status: SessionRoundStatus;
  // Did the wallet stake into this round? Null when the deposit was
  // refunded (round under-filled or position never entered).
  depositMicroUsdc: number | null;
  depositRefunded: boolean;
  // Side the wallet locked on (null when only deposited, never entered).
  lockedSide: SpotrSide | null;
  // What the wallet's stake settled to: stake locked, claimable proceeds,
  // already claimed.
  stakeMicroUsdc: number;
  claimableMicroUsdc: number;
  claimedMicroUsdc: number;
  // Final outcome at the round level.
  winningSide: SpotrSide | null;
  redistributeApplied: boolean;
};

export type ProfileSessionRoundsResponse = {
  rounds: ProfileSessionRoundRow[];
};

export type AdminCursor = string | null;

export type AdminSessionListItem = {
  id: string;
  slug: string;
  title: string;
  status: SessionStatus;
  startsAtIso: string;
  endsAtIso: string;
  activatedAtIso: string | null;
  completedAtIso: string | null;
  joinedWallets: number;
  totalEscrowLamports: number;
  protocolFeeAccruedLamports: number;
  chainSessionNumber: string | null;
  chainSessionAddress: string | null;
  chainDeployTxSignature: string | null;
  createdAtIso: string;
  pairIds: string[];
};

export type AdminSessionListResponse = {
  items: AdminSessionListItem[];
  nextCursor: AdminCursor;
};

export type AdminSessionRoundDetail = {
  id: string;
  index: number;
  pairId: string;
  category: string;
  sideA: string;
  sideB: string;
  status: SessionRoundStatus;
  opensAtIso: string | null;
  closesAtIso: string | null;
  settledAtIso: string | null;
  sideAProbabilityPct: number;
  sideBProbabilityPct: number;
  sideATotalEntries: number;
  sideBTotalEntries: number;
  sideATotalNetLamports: number;
  sideBTotalNetLamports: number;
  totalVolumeLamports: number;
  positionsCount: number;
};

export type AdminSessionParticipantDetail = {
  id: string;
  walletAddress: string;
  joinedAtIso: string;
  totalEscrowLamports: number;
  remainingEscrowLamports: number;
  referredByWallet: string | null;
  positionsEntered: number;
  chainJoinTxSignature: string | null;
  chainPlayerSessionAddress: string | null;
};

export type AdminSessionPositionDetail = {
  id: string;
  roundId: string;
  roundIndex: number;
  walletAddress: string;
  side: SpotrSide;
  submittedAtIso: string;
  stakeLamports: number;
  feeLamports: number;
  netStakeLamports: number;
  shares: number;
  rewardDebtLamports: number;
  claimedLamports: number;
  claimedAtIso: string | null;
};

export type AdminSessionReferralDetail = {
  id: string;
  referrerWallet: string;
  refereeWallet: string;
  status: "pending" | "claimable" | "claimed";
  amountLamports: number;
  createdAtIso: string;
  claimableAtIso: string | null;
  claimedAtIso: string | null;
};

export type AdminCardPackTemplate = {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  createdAtIso: string;
};

export type AdminTransactionDetail = {
  id: string;
  sessionId: string | null;
  walletAddress: string | null;
  kind: string;
  amountLamports: number | null;
  metadataJson: string | null;
  createdAtIso: string;
};

export type AdminSessionDetail = {
  id: string;
  slug: string;
  title: string;
  seasonLabel: string;
  status: SessionStatus;
  startsAtIso: string;
  endsAtIso: string;
  activatedAtIso: string | null;
  completedAtIso: string | null;
  launchIso: string;
  joinedWallets: number;
  totalEscrowLamports: number;
  protocolFeeAccruedLamports: number;
  buyInLamports: number;
  protocolFeeBps: number;
  referralCutBps: number;
  cardRewardSlots: number;
  payoutCadenceDays: number;
  chainSessionNumber: string | null;
  chainSessionAddress: string | null;
  chainDeployTxSignature: string | null;
  createdAtIso: string;
  rounds: AdminSessionRoundDetail[];
  participants: AdminSessionParticipantDetail[];
  positions: AdminSessionPositionDetail[];
  referrals: AdminSessionReferralDetail[];
  transactions: AdminTransactionDetail[];
  cardPackTemplates: AdminCardPackTemplate[];
};

export type AdminPlayerListItem = {
  walletAddress: string;
  displayName: string | null;
  sessionsJoined: number;
  totalStakedLamports: number;
  totalEscrowLamports: number;
  remainingEscrowLamports: number;
  positionsEntered: number;
  rewardsAssigned: number;
  referredByWallet: string | null;
  firstJoinedAtIso: string | null;
  lastJoinedAtIso: string | null;
};

export type AdminPlayerListResponse = {
  items: AdminPlayerListItem[];
  nextCursor: AdminCursor;
};

export type AdminPlayerSessionRow = {
  participantId: string;
  sessionId: string;
  sessionTitle: string;
  status: SessionStatus;
  joinedAtIso: string;
  totalEscrowLamports: number;
  remainingEscrowLamports: number;
  positionsEntered: number;
};

export type AdminPlayerPositionRow = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  roundIndex: number;
  category: string;
  side: SpotrSide;
  stakeLamports: number;
  feeLamports: number;
  claimedLamports: number;
  submittedAtIso: string;
};

export type AdminPlayerReward = {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  status: "assigned" | "claimable" | "claimed";
  assignedAtIso: string;
  claimedAtIso: string | null;
  sessionId: string | null;
};

export type AdminPlayerReferralPanel = {
  referredByWallet: string | null;
  referredCount: number;
  totalAccruedLamports: number;
  paidOutLamports: number;
  balanceDueLamports: number;
};

export type AdminPlayerDetail = {
  walletAddress: string;
  displayName: string | null;
  firstJoinedAtIso: string | null;
  lastJoinedAtIso: string | null;
  sessions: AdminPlayerSessionRow[];
  positions: AdminPlayerPositionRow[];
  rewards: AdminPlayerReward[];
  referralPanel: AdminPlayerReferralPanel;
};

export type AdminTransactionListResponse = {
  items: AdminTransactionDetail[];
  nextCursor: AdminCursor;
};

export type AdminReferralListResponse = {
  items: AdminReferralBalance[];
  nextCursor: AdminCursor;
};

export type AdminReferralBatch = {
  id: string;
  referrerWallet: string;
  adminWalletAddress: string;
  totalLamports: number;
  referralCount: number;
  paidAtIso: string;
};

export type AdminReferralBatchListResponse = {
  items: AdminReferralBatch[];
  nextCursor: AdminCursor;
};

export type AdminReferrerDetail = {
  referrerWallet: string;
  referredWallets: number;
  totalAccruedLamports: number;
  paidOutLamports: number;
  balanceDueLamports: number;
  batches: AdminReferralBatch[];
  refereeBreakdown: ReferredWalletContribution[];
  activeAccruals: AdminSessionReferralDetail[];
};

export type AdminRewardItem = {
  id: string;
  walletAddress: string;
  sessionId: string | null;
  sessionTitle: string | null;
  kind: RewardKind;
  title: string;
  subtitle: string;
  status: "assigned" | "claimable" | "claimed";
  assignedAtIso: string;
  claimedAtIso: string | null;
};

export type AdminRewardListResponse = {
  items: AdminRewardItem[];
  nextCursor: AdminCursor;
};

export type AdminAuditEntry = {
  id: string;
  actor: string | null;
  kind: string;
  sessionId: string | null;
  amountLamports: number | null;
  metadataJson: string | null;
  createdAtIso: string;
};

export type AdminAuditListResponse = {
  items: AdminAuditEntry[];
  nextCursor: AdminCursor;
};

export type AdminTimePoint = {
  dateIso: string;
  value: number;
};

export type AdminTopReferrer = {
  referrerWallet: string;
  referredCount: number;
  balanceDueLamports: number;
  totalAccruedLamports: number;
};

export type AdminSideDistributionPoint = {
  roundId: string;
  sessionTitle: string;
  roundIndex: number;
  category: string;
  sideACount: number;
  sideBCount: number;
};

export type AdminAnalytics = {
  rangeFromIso: string;
  rangeToIso: string;
  volumeByDay: AdminTimePoint[];
  feesByDay: AdminTimePoint[];
  joinsByDay: AdminTimePoint[];
  expiryRateByDay: AdminTimePoint[];
  topReferrers: AdminTopReferrer[];
  sideDistribution: AdminSideDistributionPoint[];
};

export type AdminPairTableRow = {
  id: string;
  slug: string;
  category: string;
  sideA: string;
  sideB: string;
  defaultSideAPct: number;
  defaultSideBPct: number;
  crowdLabel: string;
  active: boolean;
  assigned: boolean;
  createdAtIso: string;
};

export type AdminPairListResponse = {
  items: AdminPairTableRow[];
  nextCursor: AdminCursor;
};

export type AdminOverviewSparkline = {
  volumeByDay: AdminTimePoint[];
  feesByDay: AdminTimePoint[];
  joinsByDay: AdminTimePoint[];
};

export type AdminOverviewResponse = {
  summary: AdminSummary;
  sparklines: AdminOverviewSparkline;
  recentTransactions: AdminTransactionDetail[];
  liveSessionTitles: string[];
};

export type AdminOpsRoundRow = {
  sessionId: string;
  sessionTitle: string;
  chainSessionNumber: string | null;
  chainSessionAddress: string | null;
  roundId: string;
  roundIndex: number;
  category: string;
  closesAtIso: string | null;
  status: SessionRoundStatus;
};

export type AdminOpsSessionRow = {
  sessionId: string;
  sessionTitle: string;
  chainSessionNumber: string | null;
  chainSessionAddress: string | null;
  status: SessionStatus;
  endsAtIso: string;
  joinedWallets: number;
  totalEscrowLamports: number;
  protocolFeeAccruedLamports: number;
};

export type AdminOpsResponse = {
  staleRounds: AdminOpsRoundRow[];
  finalizableSessions: AdminOpsSessionRow[];
  sweepableRounds: AdminOpsRoundRow[];
  withdrawableSessions: AdminOpsSessionRow[];
};
