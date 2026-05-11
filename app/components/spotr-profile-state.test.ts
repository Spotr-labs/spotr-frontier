import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { ProfileSummary, SpotrDashboardPayload } from "../lib/spotr-types";
import {
  getDashboardProfileLoadState,
  getSpotrProfileRouteState,
  getSpotrProfileWalletAddress,
  resolveDashboardBootstrapFailure,
  resolveDashboardBootstrapSuccess,
} from "./spotr-profile-state";

const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVMg7j8A33aYw2GxY6hF";

function makeProfileSummary(
  walletAddress: string = WALLET
): ProfileSummary {
  return {
    walletAddress,
    displayName: null,
    paidSessions: 0,
    cumulativePnlLamports: 0,
    referredWallets: 0,
    referralPendingLamports: 0,
    referralPaidOutLamports: 0,
    claimableRoundLamports: 0,
    claimableSessionBalanceLamports: 0,
    referredWalletBreakdown: [],
    rewards: [],
  };
}

function makePayload(profile: ProfileSummary | null): SpotrDashboardPayload {
  return {
    session: {
      id: "session-1",
      title: "Session 1",
      status: "pending",
      walletsJoined: 0,
      totalEscrowLamports: 0,
      protocolFeeAccruedLamports: 0,
      startsAtIso: "2026-05-11T00:00:00.000Z",
      endsAtIso: "2026-05-11T01:00:00.000Z",
      activatedAtIso: null,
      referralCutBps: 0,
      rounds: [],
      joined: false,
      remainingEscrowLamports: null,
      claimableSessionBalanceLamports: 0,
      currentRoundId: null,
      currentRoundIndex: null,
      chainSessionNumber: null,
      chainSessionAddress: null,
      participant: null,
    },
    faultLines: [],
    profile,
    admin: {
      authorized: false,
      lowPairAlert: false,
      liveSessions: 0,
      pendingSessions: 0,
      activePairs: 0,
      availablePairs: 0,
      protocolFeesLamports: 0,
      pendingReferralLamports: 0,
      assignedRewards: 0,
      claimableRewards: 0,
      recentTransactions: [],
      recentRewards: [],
      participants: [],
      pairLibrary: [],
      sessionHistory: [],
      nextSessionsCursor: null,
      referralBalances: [],
    },
    availableSessions: [],
  };
}

test("wallet bootstrap response wins over a stale anonymous bootstrap response", () => {
  const anonymousPayload = makePayload(null);
  const walletPayload = makePayload(makeProfileSummary());

  const walletResolved = resolveDashboardBootstrapSuccess({
    latestRequestId: 2,
    requestId: 2,
    requestedWalletAddress: WALLET,
    payload: walletPayload,
    currentData: anonymousPayload,
    currentProfileLoadError: null,
    currentProfileLoadState: getDashboardProfileLoadState(WALLET),
  });

  assert.equal(walletResolved.accepted, true);
  assert.equal(walletResolved.data.profile?.walletAddress, WALLET);
  assert.equal(walletResolved.profileLoadState, "idle");

  const staleAnonymousResolved = resolveDashboardBootstrapSuccess({
    latestRequestId: 2,
    requestId: 1,
    requestedWalletAddress: null,
    payload: anonymousPayload,
    currentData: walletResolved.data,
    currentProfileLoadError: walletResolved.profileLoadError,
    currentProfileLoadState: walletResolved.profileLoadState,
  });

  assert.equal(staleAnonymousResolved.accepted, false);
  assert.equal(staleAnonymousResolved.data.profile?.walletAddress, WALLET);
});

test("connected wallet while bootstrap is pending stays in loading state", () => {
  const state = getSpotrProfileRouteState({
    walletAddress: WALLET,
    profile: null,
    profileLoadState: "pending",
  });

  assert.equal(state, "loading");
});

test("disconnected wallet shows the connect prompt state", () => {
  const state = getSpotrProfileRouteState({
    walletAddress: null,
    profile: null,
    profileLoadState: "idle",
  });

  assert.equal(state, "disconnected");
});

test("connected wallet with empty history still resolves to the ready profile shell", () => {
  const state = getSpotrProfileRouteState({
    walletAddress: WALLET,
    profile: makeProfileSummary(),
    profileLoadState: "idle",
  });

  assert.equal(state, "ready");
  assert.equal(
    getSpotrProfileWalletAddress({
      walletAddress: WALLET,
      profile: makeProfileSummary(),
    }),
    WALLET
  );
});

test("connected wallet bootstrap failure surfaces the error state", () => {
  const failure = resolveDashboardBootstrapFailure({
    latestRequestId: 3,
    requestId: 3,
    requestedWalletAddress: WALLET,
    errorMessage: "HTTP 500",
    currentData: makePayload(null),
    currentProfileLoadError: null,
    currentProfileLoadState: "pending",
  });

  assert.equal(failure.accepted, true);
  assert.equal(failure.profileLoadState, "error");
  assert.equal(failure.profileLoadError, "HTTP 500");
  assert.equal(
    getSpotrProfileRouteState({
      walletAddress: WALLET,
      profile: null,
      profileLoadState: failure.profileLoadState,
    }),
    "error"
  );
});
