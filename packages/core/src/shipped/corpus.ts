import type { ShippedCorpusKind } from "@growthmind/shared";
import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";

import type { CountBasis } from "../counts/measured-count";
import type { DetectorCorpus } from "../detect/types";
import { eligibleSessionsFor, rebuildBasis, tallyPeople, whoCountsIsReadable } from "./eligibility";

const AT_PAGE: unique symbol = Symbol("growthmind.at-page-corpus");

export type AtPageCorpus = {
  readonly kind: ShippedCorpusKind;

  // Rebuilt over the sessions that reached the page, so measuredCount's denominator rule carries
  // the meaning rather than merely being satisfied.
  readonly basis: CountBasis;

  readonly peopleBasis: CountBasis | null;
  readonly timeframe: { readonly start: Date; readonly end: Date };
  readonly truncated: boolean;
  readonly touchedSessions: number;
  readonly repeatPeople: number;
  readonly unidentifiedEligible: number;
  readonly [AT_PAGE]: true;
};

export type BuildAtPageCorpusInput = {
  readonly corpus: DetectorCorpus;
  readonly kind: ShippedCorpusKind;
  readonly page: string;
  readonly controlLabel: string;
  readonly pageNormalisationVersion: number;
};

export type AtPageRefusal = "stale_page_spelling" | "corpus_predates_who_counts";

export type BuildAtPageCorpusResult =
  | { readonly ok: true; readonly corpus: AtPageCorpus }
  | { readonly ok: false; readonly reason: AtPageRefusal };

// The only constructor, so a numerator drawn from one corpus and a denominator drawn from
// another are not separately passable.
export function buildAtPageCorpus(input: BuildAtPageCorpusInput): BuildAtPageCorpusResult {
  if (input.pageNormalisationVersion !== URL_PATH_NORMALISATION_VERSION) {
    return { ok: false, reason: "stale_page_spelling" };
  }

  if (!whoCountsIsReadable(input.corpus)) {
    return { ok: false, reason: "corpus_predates_who_counts" };
  }

  const eligible = eligibleSessionsFor(input.corpus, input.kind, input.page, input.controlLabel);
  const basis = rebuildBasis(eligible.map((entry) => entry.session));
  const people = tallyPeople(eligible);

  const touchedSessions = eligible.filter(
    (entry) => entry.touched && entry.session.exclusionReason === "none",
  ).length;

  return {
    ok: true,
    corpus: {
      kind: input.kind,
      basis,
      peopleBasis: people.basis,
      timeframe: input.corpus.window,
      truncated: input.corpus.coverage.truncated,
      touchedSessions,
      repeatPeople: people.returned,
      unidentifiedEligible: people.unidentified,
      [AT_PAGE]: true,
    },
  };
}
