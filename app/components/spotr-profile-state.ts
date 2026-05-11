import type { ProfileSummary, SpotrDashboardPayload } from "../lib/spotr-types";

export type DashboardProfileLoadState = "idle" | "pending" | "error";

type DashboardBootstrapBase = {
  latestRequestId: number;
  requestId: number;
  requestedWalletAddress: string | null;
  currentData: SpotrDashboardPayload;
  currentProfileLoadError: string | null;
  currentProfileLoadState: DashboardProfileLoadState;
};

type DashboardBootstrapSuccess = DashboardBootstrapBase & {
  payload: SpotrDashboardPayload;
};

type DashboardBootstrapFailure = DashboardBootstrapBase & {
  errorMessage: string;
};

export function getDashboardProfileLoadState(
  requestedWalletAddress: string | null
): DashboardProfileLoadState {
  return requestedWalletAddress ? "pending" : "idle";
}

export function resolveDashboardBootstrapSuccess({
  latestRequestId,
  requestId,
  requestedWalletAddress,
  payload,
  currentData,
  currentProfileLoadError,
  currentProfileLoadState,
}: DashboardBootstrapSuccess) {
  if (requestId !== latestRequestId) {
    return {
      accepted: false,
      data: currentData,
      profileLoadError: currentProfileLoadError,
      profileLoadState: currentProfileLoadState,
    };
  }

  if (requestedWalletAddress && !payload.profile) {
    return {
      accepted: true,
      data: currentData,
      profileLoadError: "Profile unavailable for this wallet.",
      profileLoadState: "error" as const,
    };
  }

  return {
    accepted: true,
    data: payload,
    profileLoadError: null,
    profileLoadState: "idle" as const,
  };
}

export function resolveDashboardBootstrapFailure({
  latestRequestId,
  requestId,
  requestedWalletAddress,
  errorMessage,
  currentData,
  currentProfileLoadError,
  currentProfileLoadState,
}: DashboardBootstrapFailure) {
  if (requestId !== latestRequestId) {
    return {
      accepted: false,
      data: currentData,
      profileLoadError: currentProfileLoadError,
      profileLoadState: currentProfileLoadState,
    };
  }

  return {
    accepted: true,
    data: currentData,
    profileLoadError: requestedWalletAddress ? errorMessage : null,
    profileLoadState: requestedWalletAddress ? ("error" as const) : ("idle" as const),
  };
}

export function getSpotrProfileRouteState(input: {
  walletAddress: string | null;
  profile: ProfileSummary | null;
  profileLoadState: DashboardProfileLoadState;
}) {
  const { walletAddress, profile, profileLoadState } = input;
  if (!walletAddress) return "disconnected" as const;
  if (profileLoadState === "error") return "error" as const;
  if (!profile || profile.walletAddress !== walletAddress) return "loading" as const;
  return "ready" as const;
}

export function getSpotrProfileWalletAddress(input: {
  walletAddress: string | null;
  profile: ProfileSummary | null;
}) {
  return input.profile?.walletAddress ?? input.walletAddress;
}
