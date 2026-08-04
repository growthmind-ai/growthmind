import type { SurfaceRole } from "./types";

// One sentence per role, written to be read by a founder and parsed by an agent — §10's
// one-output-two-audiences rule, so there is no second agent-facing wording to drift.
export const SURFACE_ROLE_NOTES: Record<SurfaceRole, string> = {
  makes_money: "This is where people pay.",
  first_value: "This is where someone new first gets something out of this product.",
  leads_to_money: "This is on the way to paying.",
  keeps_people: "This is what brings people back.",
  unknown: "Nothing has been said about what this page is for.",
};

export const NOTHING_KNOWN_YET_NOTE =
  "Nothing has been recorded about this product's pages yet, so treat none of this as a steer.";

export const ALL_GROWTH_MESSAGES: readonly string[] = [
  ...Object.values(SURFACE_ROLE_NOTES),
  NOTHING_KNOWN_YET_NOTE,
];
