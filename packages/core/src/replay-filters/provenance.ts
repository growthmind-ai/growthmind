import {
  PROVENANCE_COMPANY_CLAUSE_TEMPLATE,
  PROVENANCE_ENTRY_CLAUSE_TEMPLATE,
  PROVENANCE_SENTENCE_TEMPLATE,
  REPLAY_LANE_PHRASE_MANY,
  REPLAY_LANE_PHRASE_ONE,
  REPLAY_NOUN_MANY,
  REPLAY_NOUN_ONE,
  REPLAY_TAIL_NOTE_MANY,
  REPLAY_TAIL_NOTE_ONE,
} from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import type { ReplayProvenance } from "./select";
import { fill } from "./template";

// Zero takes the plural, because the digit is the point: "0 replays from 0 sessions", never
// "no replays" (UX §4.2).
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function provenanceSentence(provenance: ReplayProvenance, filters: ReplayFilters): string {
  const { replays, sessions } = provenance;

  let sessionPhrase = plural(
    sessions,
    REPLAY_LANE_PHRASE_ONE[filters.lane],
    REPLAY_LANE_PHRASE_MANY[filters.lane],
  );

  if (filters.company !== null) {
    sessionPhrase = fill(PROVENANCE_COMPANY_CLAUSE_TEMPLATE, {
      company: filters.company,
      phrase: sessionPhrase,
    });
  }

  if (filters.entry !== null) {
    sessionPhrase = fill(PROVENANCE_ENTRY_CLAUSE_TEMPLATE, {
      phrase: sessionPhrase,
      entry: filters.entry,
    });
  }

  return fill(PROVENANCE_SENTENCE_TEMPLATE, {
    replays: String(replays),
    replayNoun: plural(replays, REPLAY_NOUN_ONE, REPLAY_NOUN_MANY),
    sessions: String(sessions),
    sessionPhrase,
  });
}

// The reconciliation between the sentence's denominator and the number of cards below it.
export function tailNote(provenance: ReplayProvenance): string | null {
  const unrecorded = provenance.sessions - provenance.replays;

  if (unrecorded <= 0) return null;
  if (unrecorded === 1) return REPLAY_TAIL_NOTE_ONE;

  return fill(REPLAY_TAIL_NOTE_MANY, { count: String(unrecorded) });
}
