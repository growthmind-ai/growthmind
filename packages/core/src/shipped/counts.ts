import type { MeasuredCount, Rate } from "../counts/measured-count";
import { measuredCount, rateOf } from "../counts/measured-count";
import type { AtPageCorpus } from "./corpus";

export type ShippedCounts = {
  readonly reach: MeasuredCount;

  // Absent when no eligible session carries an identity: an absent number beats a wrong one.
  readonly repeat: MeasuredCount | null;

  readonly repeatRate: Rate;
};

// The one constructor for the reason rateOf can never return, which is what keeps every existing
// no_rate reader accurate for the only reason that reaches it.
export function noRateForIdentity(): Rate {
  return { kind: "no_rate", reason: "no_identity_coverage" };
}

export function shippedCounts(corpus: AtPageCorpus): ShippedCounts {
  const reach = measuredCount({
    numerator: corpus.touchedSessions,
    denominator: corpus.basis.kept,
    unit: "sessions",
    timeframe: corpus.timeframe,
    basis: corpus.basis,
  });

  const peopleBasis = corpus.peopleBasis;
  if (peopleBasis === null) {
    return { reach, repeat: null, repeatRate: noRateForIdentity() };
  }

  const repeat = measuredCount({
    numerator: corpus.repeatPeople,
    denominator: peopleBasis.kept,
    unit: "people",
    timeframe: corpus.timeframe,
    basis: peopleBasis,
  });

  return { reach, repeat, repeatRate: rateOf(repeat) };
}
