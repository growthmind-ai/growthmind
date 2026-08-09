import type { ShippedLeadCount } from "@growthmind/shared";
import {
  SHIPPED_NOBODY_TEMPLATE,
  SHIPPED_NO_IDENTITY_LINE,
  SHIPPED_PAGE_REACH_TEMPLATE,
  SHIPPED_REACH_TEMPLATE,
  SHIPPED_RECORDED_CORPUS_LINE,
  SHIPPED_REPEAT_TEMPLATE,
  SHIPPED_SPELLING_CHANGED_TEMPLATE,
  SHIPPED_SPINE_CORPUS_LINE,
  SHIPPED_TOO_FEW_TEMPLATE,
  SHIPPED_TRUNCATED_LINE,
  SHIPPED_UNIDENTIFIED_TEMPLATE,
  SHIPPED_UNREADABLE_TEMPLATE,
  SHIPPED_VERDICT_KEEP_ACTION_ID,
  SHIPPED_VERDICT_KEEP_LABEL,
  SHIPPED_VERDICT_KILL_ACTION_ID,
  SHIPPED_VERDICT_KILL_LABEL,
  SHIPPED_VERDICT_LEAVE_ACTION_ID,
  SHIPPED_VERDICT_LEAVE_LABEL,
  SHIPPED_VERDICT_QUESTION,
} from "@growthmind/shared";

import { fill } from "../replay-filters/template";
import type { AtPageCorpus } from "./corpus";
import type { ShippedCounts } from "./counts";

export type ShippedReadoutResult =
  | { readonly kind: "claim"; readonly corpus: AtPageCorpus; readonly counts: ShippedCounts }
  | { readonly kind: "too_few"; readonly corpus: AtPageCorpus }
  | { readonly kind: "stale_page_spelling" }
  | { readonly kind: "corpus_predates_who_counts" };

export type ShippedReadoutAction = {
  readonly actionId: string;
  readonly label: string;

  // The change's id travels here and never in the body, because Slack renders one and not the
  // other.
  readonly value: string;
};

export type ShippedReadout = {
  readonly body: string;
  readonly actions: readonly ShippedReadoutAction[];
};

export type ShippedReadoutInput = {
  readonly changeId: string;
  readonly change: string;
  readonly page: string;
  readonly leadCount: ShippedLeadCount;
  readonly result: ShippedReadoutResult;
};

function corpusLines(corpus: AtPageCorpus): readonly string[] {
  const named = corpus.kind === "page" ? SHIPPED_SPINE_CORPUS_LINE : SHIPPED_RECORDED_CORPUS_LINE;

  return corpus.truncated ? [named, SHIPPED_TRUNCATED_LINE] : [named];
}

function reachSentence(input: ShippedReadoutInput, result: ShippedReadoutResult): string {
  if (result.kind !== "claim") return "";

  const values = {
    change: input.change,
    page: input.page,
    denominator: String(result.counts.reach.denominator),
    numerator: String(result.counts.reach.numerator),
  };

  // The page is the change, so "touched it" and "reached it" are the same set and a fraction of
  // itself would say nothing. Repeat carries the fraction against the same denominator.
  if (result.corpus.kind === "page") return fill(SHIPPED_PAGE_REACH_TEMPLATE, values);

  if (result.corpus.touchedSessions === 0) return fill(SHIPPED_NOBODY_TEMPLATE, values);

  return fill(SHIPPED_REACH_TEMPLATE, values);
}

function repeatSentences(corpus: AtPageCorpus, counts: ShippedCounts): readonly string[] {
  const repeat = counts.repeat;
  if (repeat === null) return [SHIPPED_NO_IDENTITY_LINE];

  if (corpus.touchedSessions === 0) return [];

  const came = fill(SHIPPED_REPEAT_TEMPLATE, {
    numerator: String(repeat.numerator),
    denominator: String(repeat.denominator),
  });

  if (corpus.unidentifiedEligible > 0) {
    return [
      came,
      fill(SHIPPED_UNIDENTIFIED_TEMPLATE, { count: String(corpus.unidentifiedEligible) }),
    ];
  }

  return [came];
}

function claimSentences(
  input: ShippedReadoutInput,
  result: ShippedReadoutResult,
): readonly string[] {
  if (result.kind !== "claim") return [];

  const reach = reachSentence(input, result);
  const repeat = repeatSentences(result.corpus, result.counts);

  const counted = input.leadCount === "repeat" ? [...repeat, reach] : [reach, ...repeat];

  return [...counted, ...corpusLines(result.corpus)];
}

function sentencesFor(input: ShippedReadoutInput): readonly string[] {
  const result = input.result;
  const values = { change: input.change, page: input.page };

  if (result.kind === "stale_page_spelling") {
    return [fill(SHIPPED_SPELLING_CHANGED_TEMPLATE, values)];
  }

  if (result.kind === "corpus_predates_who_counts") {
    return [fill(SHIPPED_UNREADABLE_TEMPLATE, values)];
  }

  if (result.kind === "too_few") {
    return [
      fill(SHIPPED_TOO_FEW_TEMPLATE, {
        ...values,
        denominator: String(result.corpus.basis.kept),
      }),
      ...corpusLines(result.corpus),
    ];
  }

  return claimSentences(input, result);
}

function verdictActions(changeId: string): readonly ShippedReadoutAction[] {
  return [
    {
      actionId: SHIPPED_VERDICT_KEEP_ACTION_ID,
      label: SHIPPED_VERDICT_KEEP_LABEL,
      value: changeId,
    },
    {
      actionId: SHIPPED_VERDICT_KILL_ACTION_ID,
      label: SHIPPED_VERDICT_KILL_LABEL,
      value: changeId,
    },
    {
      actionId: SHIPPED_VERDICT_LEAVE_ACTION_ID,
      label: SHIPPED_VERDICT_LEAVE_LABEL,
      value: changeId,
    },
  ];
}

export function renderShippedReadout(input: ShippedReadoutInput): ShippedReadout {
  const said = sentencesFor(input).filter((sentence) => sentence.length > 0);

  return {
    body: [...said, SHIPPED_VERDICT_QUESTION].join(" "),
    actions: verdictActions(input.changeId),
  };
}
