import type { SpotrPublicConfig } from "../spotr-types";

export function getSessionWindowForDate(anchor: Date, config: SpotrPublicConfig) {
  const startsAt = new Date(anchor);
  startsAt.setUTCHours(config.defaultSessionStartHourUtc, 0, 0, 0);

  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(config.defaultSessionEndHourUtc, 0, 0, 0);
  if (endsAt <= startsAt) {
    endsAt.setUTCDate(endsAt.getUTCDate() + 1);
  }

  return { startsAt, endsAt };
}

export function getNextDeployWindow(
  config: SpotrPublicConfig,
  reference = new Date()
) {
  const current = new Date(reference);
  const todayWindow = getSessionWindowForDate(current, config);
  if (current < todayWindow.startsAt) {
    return todayWindow;
  }
  if (current < todayWindow.endsAt) {
    return {
      startsAt: current,
      endsAt: todayWindow.endsAt,
    };
  }

  const nextDay = new Date(current);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return getSessionWindowForDate(nextDay, config);
}
