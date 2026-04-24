import faultLineCatalog from "../../../data/fault-line-catalog.json";

export type LaunchFaultLineSeed = {
  slug: string;
  category: string;
  sideA: string;
  sideB: string;
  sideAPct: number;
  sideBPct: number;
  crowdLabel: string;
};

// Canonical launch seed derived from resources/SPOTR MARKETS (1)/data.js.
export const launchFaultLineSeeds = faultLineCatalog satisfies LaunchFaultLineSeed[];
