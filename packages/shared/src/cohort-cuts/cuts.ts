import { BROWSER_FAMILIES, classifyBrowserFamily, type BrowserFamily } from "./browsers";
import { DEVICE_TYPES, classifyDeviceType, type DeviceType } from "./devices";

export const SURFACE_COHORT_CUT = "surface";

export type BrowserCohortCut = `browser:${BrowserFamily}`;

export type DeviceCohortCut = `device:${DeviceType}`;

export type CohortCut = typeof SURFACE_COHORT_CUT | BrowserCohortCut | DeviceCohortCut;

export function browserCut(family: BrowserFamily): BrowserCohortCut {
  return `browser:${family}`;
}

export function deviceCut(device: DeviceType): DeviceCohortCut {
  return `device:${device}`;
}

export const COHORT_CUTS: readonly [CohortCut, ...CohortCut[]] = [
  SURFACE_COHORT_CUT,
  ...BROWSER_FAMILIES.map((family) => browserCut(family)),
  ...DEVICE_TYPES.map((device) => deviceCut(device)),
];

export type SessionCohortCuts = {
  readonly browser: BrowserFamily;
  readonly device: DeviceType;
};

export function cohortCutsOfUserAgent(userAgent: string | null | undefined): SessionCohortCuts {
  return {
    browser: classifyBrowserFamily(userAgent),
    device: classifyDeviceType(userAgent),
  };
}
