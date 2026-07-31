// The Slack renderer (O-007) — a finding, or an explicit quiet day, turned into
// the message a founder actually reads.
//
// ── PURE, AND NO SLACK IN IT ────────────────────────────────────────────────
// No SDK call, no network, no clock, no randomness. This module returns a plain
// data structure; POSTING is a later slice's job and lives behind the delivery
// adapter. That split is what lets every rule below be asserted by a unit test
// rather than by reading a Slack channel afterwards, and it keeps
// `@growthmind/core`'s two-dependency rule (`@growthmind/shared` and `zod`)
// intact.
//
// ── ONE VOCABULARY, PASSED IN ───────────────────────────────────────────────
// Every fixed customer-facing sentence comes from `@growthmind/shared`:
// `SUMMARY_SOURCE_MESSAGES` for the numbers-only degradations (imported
// directly), and `DELIVERY_VOCABULARY` for the delivery lane's own strings
// (passed in as a REQUIRED argument, because `@growthmind/shared` exposes one
// entry point and `packages/core` cannot deep import
// `src/delivery/messages.ts`). The vocabulary's maps are typed `Record<Union,
// string>` over the same closed unions the shared module keys them by, so the
// two ends cannot disagree about which members exist (D11: the key set is the
// union, not a hand-passed list). NOTHING customer-facing is authored here that
// could have been authored there — the only English this file contributes is
// the arithmetic scaffolding around a count ("3 of 28 sessions"), which is
// assembled from `MeasuredCount`'s own fields including the unit the type
// itself declares.
//
// ── A COUNT IS NEVER A PEOPLE COUNT ─────────────────────────────────────────
// `../counts/measured-count.ts:60-69`: identity stitching does not exist in
// this product, so "3 of 40" means 3 of 40 SESSIONS and nothing else. Two
// guards, with deliberately different fail directions:
//   - a caller-supplied observation LABEL naming a cohort of humans is REFUSED
//     (a detector label is our own code; naming people there would make every
//     count that label decorates a false claim, and that is a caller bug);
//   - MODEL-WRITTEN prose naming a cohort of humans is DROPPED, and the message
//     degrades to the numbers-only form it already supports, reported as
//     `floor_model_text_rejected` — the `summary_source` member that exists for
//     exactly this ("generated but did not pass our accuracy check"). Refusing
//     the whole delivery over a model's word choice would withhold a true
//     finding; dropping the prose keeps the finding and loses only the prose.
// Neither guard ever inspects the customer's own surface path: `/users/profile`
// is a real page and must be rendered verbatim, because a finding about a page
// we renamed is a finding nobody can act on.
//
// ── THE LEGIBILITY BUDGET IS A PRODUCT CONSTRAINT, NOT SLACK'S ──────────────
// See `SLACK_MESSAGE_CHARACTER_BUDGET` below. Slack would accept far more; a
// founder would not read it.
//
// ── COMPOSING TWO COUNTS (SAC-11) ───────────────────────────────────────────
// `packages/shared/src/summary/messages.ts:23-61` states the rule this renderer
// inherits: two counts may sit in one message provided each names its own
// number with its own denominator and neither borrows the other's subject.
// That is exactly what `renderCountSentence` produces — one self-contained
// sentence per observation, on its own line, joined by nothing. No pronoun, no
// "then", no connective is ever inserted between two observations by this file.
import { SUMMARY_SOURCE_MESSAGES, nothingTodayReasonSchema } from "@growthmind/shared";
import type { NothingTodayReason } from "@growthmind/shared";
import { z } from "zod";

import { measuredCountSchema, rateOf } from "../counts/measured-count";
import type { MeasuredCount } from "../counts/measured-count";
// ONE definition, not two. O-005 already narrowed `summary_source` to its
// model-free members in `../summary/types` and documented why the narrowing
// lives in `core` rather than in `shared`. Re-deriving it here would have given
// the codebase two `FloorSummarySource`s that drift the day a seventh
// `summary_source` member lands — which is the duplication this repo's
// "one implementation, reused by many" rule exists to prevent.
import { floorSummarySourceSchema } from "../summary/types";
import type { FloorSummarySource } from "../summary/types";

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * The most characters a rendered message may contain, counted on the plaintext
 * fallback (the same text a phone shows in a notification).
 *
 * WHY 900, out loud. Slack's own limit is 3000 characters per section block, so
 * Slack is not the constraint — legibility is. 900 characters is roughly 150
 * words, about forty seconds of reading, and about one phone screen: past that
 * the Slack client folds the message behind "Show more", and what gets folded
 * is the second half of the evidence. A finding a founder has to expand before
 * they can judge it has already lost the argument (product decisions §10 — this
 * product is Slack-first and non-dashboard, so this message is the whole
 * surface, not a teaser for one).
 *
 * The budget is enforced by CONSTRUCTION, not by hope: every variable-length
 * part has its own budget below, and `renderSlackMessage` walks a deterministic
 * reduction ladder and then clamps, so an unbounded surface path or an
 * unbounded model paragraph cannot push a message past this number.
 */
export const SLACK_MESSAGE_CHARACTER_BUDGET = 900;

/**
 * The most newline-separated lines a rendered message may contain. Twelve is
 * about what a phone shows above the fold; a thirteenth line is a line nobody
 * scrolled to.
 */
export const SLACK_MESSAGE_LINE_BUDGET = 12;

/**
 * A surface path longer than this is truncated in the MIDDLE, keeping the head
 * and the tail — the tail (`/step-two`) is what identifies the page to somebody
 * who works on it, so an end-truncated path is the one shape that would make
 * the finding unactionable.
 */
export const SURFACE_PATH_BUDGET = 48;

/** The model's one-line restatement. One line, on a phone. */
export const HEADLINE_BUDGET = 100;

/** The model's supporting paragraph, at full length. */
export const CONTEXT_BUDGET = 280;

/** The model's supporting paragraph after the first reduction step. */
export const TIGHT_CONTEXT_BUDGET = 140;

/** What the numerator did, in the detector's own words. */
export const OBSERVATION_LABEL_BUDGET = 90;

/**
 * The most counts one message may carry.
 *
 * FAIL DIRECTION: refuse. A message listing five numbers is not read, so the
 * cap has to exist — and silently dropping the fourth observation would hide a
 * decision about what a founder is told inside a renderer. Choosing which two
 * or three numbers matter is the composer's job upstream; this file refuses
 * rather than choosing for it.
 */
export const MAX_OBSERVATIONS = 3;

/** Appended wherever text was cut. One character, so budgets stay exact. */
export const TRUNCATION_MARKER = "…";

/**
 * The nouns that turn a session count into a claim about human beings.
 *
 * Exported so a test enumerates the real list rather than a copy of it. Matched
 * whole-word and case-insensitively; `/users/profile` is a path, not a claim,
 * and is never scanned (see the header).
 */
export const COHORT_NOUNS = [
  "people",
  "person",
  "persons",
  "user",
  "users",
  "customer",
  "customers",
  "visitor",
  "visitors",
  "human",
  "humans",
  "folks",
] as const;

const COHORT_NOUN_PATTERN = new RegExp(`\\b(?:${COHORT_NOUNS.join("|")})\\b`, "i");

/** Month names, fixed and English. No `Intl`, so a rendered window is byte-identical
 * on every machine — a message whose text depends on the server's locale is a
 * message no test can pin. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * What this renderer needs from `@growthmind/shared`'s delivery vocabulary,
 * declared structurally because `shared` cannot import `core` (the dependency
 * arrow is one-way). `DELIVERY_VOCABULARY` in
 * `packages/shared/src/delivery/messages.ts` satisfies it.
 *
 * `nothingToday` is TOTAL over `NothingTodayReason`: a reason added to the
 * union without a sentence is a compile error at the shared end, and a
 * vocabulary missing one is a compile error at the call site here.
 */
export type DeliveryVocabulary = {
  readonly nothingTodayLead: string;
  readonly nothingToday: Readonly<Record<NothingTodayReason, string>>;
  readonly noRate: string;
};

/** One thing we measured, and what the numerator did. */
export type Observation = {
  /** What the numerator DID, in plain English, with no number in it. */
  readonly label: string;
  readonly count: MeasuredCount;
};

// `FloorSummarySource` — "numbers only, no written explanation" — is imported
// from `../summary/types`, not re-declared. See the import block above.

/**
 * The written explanation, or the stated absence of one.
 *
 * A discriminated shape rather than optional strings: "no written explanation"
 * and "an empty written explanation" must not be expressible as the same value,
 * because the first is a supported first-class message and the second is a bug
 * that would render a blank line into Slack.
 */
export type DeliveredExplanation =
  | { readonly source: "model_rendered"; readonly headline: string; readonly context: string }
  | { readonly source: FloorSummarySource };

/** What the scheduler hands the renderer. */
export type SlackMessageInput =
  | {
      readonly decision: "deliver";
      /** The customer's own path, rendered verbatim (middle-truncated if long). */
      readonly surfacePath: string;
      readonly observations: readonly Observation[];
      readonly explanation: DeliveredExplanation;
    }
  | {
      readonly decision: "nothing_today";
      readonly reason: NothingTodayReason;
    };

/**
 * A rendered block. `kind` is this product's word, not Slack's — the posting
 * adapter maps `section`/`context` onto Slack's own block JSON, so no vendor
 * shape leaks into `@growthmind/core`.
 */
export type SlackBlock = {
  readonly kind: "section" | "context";
  /** Slack mrkdwn. `*bold*` is the only marker this renderer emits. */
  readonly text: string;
};

/** The rendered message. Nothing here is Slack-specific except the mrkdwn markers. */
export type SlackMessage = {
  readonly blocks: readonly SlackBlock[];
  /**
   * The plaintext fallback — the notification preview, and the string the
   * budget is measured on. Markers stripped, blocks joined by newlines.
   */
  readonly text: string;
  /** Computed here so no caller re-derives it differently. */
  readonly legibility: { readonly characters: number; readonly lines: number };
};

// ---------------------------------------------------------------------------
// Runtime shapes (Zod is the runtime mirror; the TS types above are the
// primary guard, exactly as in `../counts/measured-count.ts`)
// ---------------------------------------------------------------------------

// `floorSummarySourceSchema` is imported from `../summary/types` (see the
// import block). It is already derived there with `.exclude()` rather than
// hand-listed, so a seventh `summary_source` member is covered the day it is
// added — the property this renderer needs, owned in one place.

export const observationSchema = z.object({
  label: z
    .string()
    .min(1)
    .refine((label) => !describesPeople(label), {
      // Refused, not sanitised: this string is our own detector's vocabulary,
      // and a label calling sessions "users" would make every count it
      // decorates a claim about human beings that this product cannot make.
      message: "an observation label may not describe sessions as people",
    }),
  count: measuredCountSchema,
});

export const deliveredExplanationSchema = z.union([
  z.object({
    source: z.literal("model_rendered"),
    headline: z.string().min(1),
    context: z.string().min(1),
  }),
  z.object({ source: floorSummarySourceSchema }),
]);

/**
 * The deliver arm's cross-observation invariant: every count in ONE message
 * must have been measured over the SAME window and the same basis.
 *
 * FAIL DIRECTION: refuse. Two counts from two windows in one message read as
 * two counts from one window — a founder cannot see the seam, so the seam must
 * not be renderable.
 */
const deliverInputSchema = z
  .object({
    decision: z.literal("deliver"),
    surfacePath: z.string().min(1),
    observations: z.array(observationSchema).min(1).max(MAX_OBSERVATIONS),
    explanation: deliveredExplanationSchema,
  })
  .superRefine((value, ctx) => {
    const [first, ...rest] = value.observations;
    if (!first) return;

    for (const observation of rest) {
      const sameWindow =
        observation.count.timeframe.start.getTime() === first.count.timeframe.start.getTime() &&
        observation.count.timeframe.end.getTime() === first.count.timeframe.end.getTime();
      const sameBasis =
        observation.count.denominator === first.count.denominator &&
        observation.count.basis.totalInWindow === first.count.basis.totalInWindow;

      if (!sameWindow || !sameBasis) {
        ctx.addIssue({
          code: "custom",
          path: ["observations"],
          message:
            "every count in one message must be measured over the same window and the same basis",
        });
        return;
      }
    }
  });

export const slackMessageInputSchema = z.union([
  deliverInputSchema,
  z.object({ decision: z.literal("nothing_today"), reason: nothingTodayReasonSchema }),
]);

// ---------------------------------------------------------------------------
// Text helpers — all pure, all deterministic
// ---------------------------------------------------------------------------

/**
 * True when the text names a cohort of human beings. A deterministic keyword
 * gate, so D10 applies: it MISSES, and the miss direction is chosen. A missed
 * phrasing renders prose that overstates what a session count establishes,
 * which the upstream accuracy check is the primary defence against; this gate
 * is the cheap last catch for the exact nouns, not a claim to catch all of
 * them.
 */
export function describesPeople(text: string): boolean {
  return COHORT_NOUN_PATTERN.test(text);
}

/** Cut at the end, deterministically, marker included in the budget. */
function truncateEnd(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(0, budget - TRUNCATION_MARKER.length)).trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * Cut in the middle, keeping head and tail. The tail of a path is what names
 * the page; the head is what names the flow. The split is fixed (not
 * proportional) so the same path always truncates to the same string.
 */
function truncateMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const usable = Math.max(0, budget - TRUNCATION_MARKER.length);
  const head = Math.ceil(usable / 2);
  const tail = usable - head;
  return `${text.slice(0, head)}${TRUNCATION_MARKER}${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

/** A label reads as part of a sentence this file finishes, so it carries no full stop of its own. */
function withoutTrailingStop(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

/**
 * The share, as a percentage a human reads.
 *
 * Two boundaries are named rather than rounded away, because both would print a
 * number that contradicts the count beside it:
 *   - a non-zero numerator that rounds to 0% prints "under 1%", never "0%"
 *     ("3 of 900 sessions (0%)" reads as a rendering fault);
 *   - a numerator below its denominator that rounds to 100% prints "over 99%",
 *     never "100%" (which would claim every session did it).
 */
function describeShare(count: MeasuredCount, value: number): string {
  const percent = Math.round(value * 100);

  if (count.numerator > 0 && percent === 0) return "under 1%";
  if (count.numerator < count.denominator && percent === 100) return "over 99%";
  return `${percent}%`;
}

/**
 * One count, as one self-contained sentence carrying its own denominator.
 *
 * Never "3 sessions dropped off" — always "3 of 28 sessions …". The unit comes
 * from the count's own `unit` field, whose type is the literal `"sessions"`, so
 * this sentence CANNOT be made to say people (`../counts/measured-count.ts:60-69`).
 *
 * A zero denominator returns the vocabulary's no-rate sentence instead: there is
 * no share to state, and stating "0%" would claim we measured something and
 * found none of it.
 */
export function renderCountSentence(
  observation: Observation,
  vocabulary: DeliveryVocabulary,
): string {
  const rate = rateOf(observation.count);
  if (rate.kind === "no_rate") return vocabulary.noRate;

  const label = truncateEnd(withoutTrailingStop(observation.label), OBSERVATION_LABEL_BUDGET);
  const { numerator, denominator, unit } = observation.count;

  return `${numerator} of ${denominator} ${unit} ${label} (${describeShare(observation.count, rate.value)}).`;
}

/** `2026-06-01T…` → `1 June 2026`, in UTC, with no `Intl`. */
function renderDate(instant: Date): string {
  return `${instant.getUTCDate()} ${MONTHS[instant.getUTCMonth()]} ${instant.getUTCFullYear()}`;
}

/** The window, stated. A count with an unstated window is a count nobody can act on. */
function renderWindowLine(count: MeasuredCount): string {
  return `Sessions from ${renderDate(count.timeframe.start)} to ${renderDate(count.timeframe.end)}.`;
}

/**
 * The denominator's composition, in the customer's own words — the labels come
 * from the basis rows (`EXCLUSION_REASON_LABELS`), so this message reads the
 * same vocabulary the onboarding counter does rather than inventing a second.
 */
function renderBasisLine(count: MeasuredCount): string {
  const { basis } = count;
  const setAside = basis.setAside.filter((row) => row.count > 0);

  if (setAside.length === 0) {
    return `Counted all ${basis.totalInWindow} sessions we looked at.`;
  }

  const breakdown = setAside.map((row) => `${row.count} ${row.label.toLowerCase()}`).join(", ");
  const setAsideTotal = setAside.reduce((sum, row) => sum + row.count, 0);

  return `Counted ${basis.kept} of the ${basis.totalInWindow} sessions we looked at. ${setAsideTotal} set aside: ${breakdown}.`;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** The variable parts, before the reduction ladder chooses which survive. */
type MessageParts = {
  readonly heading: string;
  readonly headline: string | null;
  readonly observations: readonly string[];
  readonly explanation: string | null;
  readonly basis: string | null;
  readonly window: string | null;
};

function blocksOf(parts: MessageParts): SlackBlock[] {
  const lead = parts.headline === null ? parts.heading : `${parts.heading}\n${parts.headline}`;
  const blocks: SlackBlock[] = [{ kind: "section", text: lead }];

  // Each observation on its own line, joined by NOTHING — no connective that
  // could hand one cohort another's behaviour (SAC-11). Bulleted only when
  // there is more than one, so a single finding does not read as a list.
  const bullet = parts.observations.length > 1 ? "• " : "";
  blocks.push({
    kind: "section",
    text: parts.observations.map((sentence) => `${bullet}${sentence}`).join("\n"),
  });

  if (parts.explanation !== null) {
    blocks.push({ kind: "section", text: parts.explanation });
  }

  const footer = [parts.basis, parts.window].filter((line): line is string => line !== null);
  if (footer.length > 0) {
    blocks.push({ kind: "context", text: footer.join("\n") });
  }

  return blocks;
}

function plainTextOf(blocks: readonly SlackBlock[]): string {
  return blocks
    .map((block) => block.text)
    .join("\n")
    .replaceAll("*", "");
}

function fits(blocks: readonly SlackBlock[]): boolean {
  const text = plainTextOf(blocks);
  return (
    text.length <= SLACK_MESSAGE_CHARACTER_BUDGET &&
    text.split("\n").length <= SLACK_MESSAGE_LINE_BUDGET
  );
}

/**
 * The last resort, reached only if every rung of the ladder still overflows.
 * Drops trailing blocks (the footer is the least load-bearing), then cuts the
 * last surviving block. Total by construction: the loop cannot exit while the
 * text is over budget and more than one block remains, and a single block is
 * then cut to size.
 */
function clampToBudget(blocks: readonly SlackBlock[]): SlackBlock[] {
  const kept: SlackBlock[] = [...blocks];

  while (kept.length > 1 && !fits(kept)) {
    kept.pop();
  }

  const last = kept[kept.length - 1];
  if (last && !fits(kept)) {
    const others = kept.slice(0, -1);
    const overheadCharacters = others.length === 0 ? 0 : plainTextOf(others).length + 1;
    const remaining = Math.max(0, SLACK_MESSAGE_CHARACTER_BUDGET - overheadCharacters);
    kept[kept.length - 1] = { kind: last.kind, text: truncateEnd(last.text, remaining) };
  }

  return kept;
}

function messageOf(blocks: readonly SlackBlock[]): SlackMessage {
  const text = plainTextOf(blocks);
  return {
    blocks,
    text,
    legibility: { characters: text.length, lines: text.split("\n").length },
  };
}

/**
 * Turn a scheduler decision into the message Slack would show.
 *
 * FAIL DIRECTION: refuse. A malformed input is a caller bug, and posting a
 * half-formed claim into a shared channel is unrecallable — so this throws
 * (via `.parse`) rather than rendering something approximate. The delivery task
 * that calls it records the terminal `failed` state and its plain-English
 * reason (`delivery_status`, D8), so a refusal here is still a state the
 * founder can see rather than silence.
 *
 * Both arms return a REAL message. `nothing_today` is a postable answer, never
 * an empty render — that is the whole point of the union in
 * `packages/shared/src/delivery/types.ts:16-32`.
 */
export function renderSlackMessage(
  input: SlackMessageInput,
  vocabulary: DeliveryVocabulary,
): SlackMessage {
  slackMessageInputSchema.parse(input);

  if (input.decision === "nothing_today") {
    return messageOf([
      {
        kind: "section",
        text: `${vocabulary.nothingTodayLead}\n${vocabulary.nothingToday[input.reason]}`,
      },
    ]);
  }

  // Model prose that calls sessions people is DROPPED, and the message becomes
  // the numbers-only form reported as `floor_model_text_rejected` — the member
  // that exists for "generated, but did not pass our accuracy check". The
  // finding itself is unchanged; only the prose is lost.
  const explanation: DeliveredExplanation =
    input.explanation.source === "model_rendered" &&
    (describesPeople(input.explanation.headline) || describesPeople(input.explanation.context))
      ? { source: "floor_model_text_rejected" }
      : input.explanation;

  const firstCount = input.observations[0]?.count;

  const parts: MessageParts = {
    heading: `*${truncateMiddle(input.surfacePath, SURFACE_PATH_BUDGET)}*`,
    headline:
      explanation.source === "model_rendered"
        ? truncateEnd(explanation.headline, HEADLINE_BUDGET)
        : null,
    observations: input.observations.map((observation) =>
      renderCountSentence(observation, vocabulary),
    ),
    // When the model wrote an explanation, its own words are the explanation —
    // `SUMMARY_SOURCE_MESSAGES.model_rendered` ("this includes a short written
    // explanation") would spend a line saying what the next line already shows.
    explanation:
      explanation.source === "model_rendered"
        ? truncateEnd(explanation.context, CONTEXT_BUDGET)
        : SUMMARY_SOURCE_MESSAGES[explanation.source],
    basis: firstCount ? renderBasisLine(firstCount) : null,
    window: firstCount ? renderWindowLine(firstCount) : null,
  };

  // THE REDUCTION LADDER, in the order things stop earning their line. The
  // numbers and the surface are never on it: they are the claim. The prose
  // shortens first, then the basis detail goes (each count still carries its
  // own denominator inline, so the message stays honest without it), then the
  // window, then the prose entirely — leaving the numbers-only form, which is a
  // supported message rather than a broken one.
  const ladder: readonly MessageParts[] = [
    parts,
    { ...parts, explanation: shortened(parts.explanation) },
    { ...parts, explanation: shortened(parts.explanation), basis: null },
    { ...parts, explanation: shortened(parts.explanation), basis: null, window: null },
    { ...parts, explanation: null, basis: null, window: null },
  ];

  for (const rung of ladder) {
    const blocks = blocksOf(rung);
    if (fits(blocks)) return messageOf(blocks);
  }

  const last = ladder[ladder.length - 1] ?? parts;
  return messageOf(clampToBudget(blocksOf(last)));
}

function shortened(explanation: string | null): string | null {
  return explanation === null ? null : truncateEnd(explanation, TIGHT_CONTEXT_BUDGET);
}
