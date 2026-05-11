import {
  RoundStatus,
  SessionStatus as PrismaSessionStatus,
} from "@prisma/client";

export function preserveUpcomingRoundStatus(
  storedStatus: RoundStatus,
  derivedStatus: RoundStatus,
  sessionStatus: PrismaSessionStatus
): RoundStatus {
  if (
    storedStatus === "UPCOMING" &&
    sessionStatus !== "COMPLETED" &&
    sessionStatus !== "EXPIRED"
  ) {
    return "UPCOMING";
  }
  return derivedStatus;
}

