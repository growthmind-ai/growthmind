import type { MeasuredCount } from "../counts/measured-count";
import type { SurfaceRole, SurfaceWorth } from "./surface-worth";

export type ExpectedValue = {
  readonly score: number;
  readonly affected: number;
  readonly weight: number;
  readonly weightVersion: number;
  readonly role: SurfaceRole;
};

// Sessions that hit the problem, not the rate: two surfaces at the same rate are not
// worth the same when one of them carries eight times the traffic.
export function expectedValueOf(affectedSessions: number, worth: SurfaceWorth): ExpectedValue {
  return {
    score: affectedSessions * worth.weight,
    affected: affectedSessions,
    weight: worth.weight,
    weightVersion: worth.weightVersion,
    role: worth.role,
  };
}

export function expectedValueOfCount(affected: MeasuredCount, worth: SurfaceWorth): ExpectedValue {
  return expectedValueOf(affected.numerator, worth);
}

const A_FIRST = -1;
const B_FIRST = 1;
const NEITHER_FIRST = 0;

export function compareExpectedValue(a: ExpectedValue, b: ExpectedValue): number {
  if (a.score > b.score) return A_FIRST;
  if (a.score < b.score) return B_FIRST;
  return NEITHER_FIRST;
}
