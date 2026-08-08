import type { PostFailureCode } from "@growthmind/shared";

import type { FindingText } from "../delivery/finding-text";

// One pure builder per type; web (bell rows) and worker (Slack render) call the same
// function — same sentence, different chrome.

export interface KeysRevokedSentenceInput {
  readonly workspaceName: string;

  // Null when the actor cannot be resolved; the unknown-revoker fallback lives inside
  // the builder — one home (ADD §3).
  readonly revokedByName: string | null;
}

// buildAgentRevokeAnnouncement's fallback, byte for byte — the bespoke module retires
// in this sprint and this is where its copy now lives.
const UNKNOWN_REVOKER = "Someone in this workspace";

// PRD FR-4's draft, PROPOSED pending Tom's sign-off.
const FIRST_CONTACT_SENTENCE = "A coding assistant connected to this workspace for the first time.";

const GENERIC_SENTENCE = "Growthmind has an update for you — open it to see the details.";

// A held text renders the generic sentence + link: this builder must not become a second
// unscanned reader path.
export function findingDeliveredSentence(text: FindingText): string {
  return text.held ? genericNotificationSentence() : text.headline;
}

export function keysRevokedSentence(input: KeysRevokedSentenceInput): string {
  const who = input.revokedByName ?? UNKNOWN_REVOKER;

  return (
    `${who} revoked every key for ${input.workspaceName}. Anything that was calling us with ` +
    `one of those keys has stopped — reconnect it with a new key when you're ready.`
  );
}

export function agentFirstContactSentence(): string {
  return FIRST_CONTACT_SENTENCE;
}

export function genericNotificationSentence(): string {
  return GENERIC_SENTENCE;
}

export interface KeyCreatedSentenceInput {
  // Null for a key minted from the CLI; the unknown-actor fallback is the revoke
  // builder's, reused rather than copied.
  readonly createdByName: string | null;
}

export function keyCreatedSentence(input: KeyCreatedSentenceInput): string {
  const who = input.createdByName ?? UNKNOWN_REVOKER;

  return `${who} created a new agent key for this workspace. If that wasn't you or your coding assistant, revoke every key in settings.`;
}

export interface BackfillCompleteSentenceInput {
  readonly sessionsTouched: number;
  readonly eventsPersisted: number;
}

export function backfillCompleteSentence(input: BackfillCompleteSentenceInput): string {
  return `We've finished reading your history — ${input.sessionsTouched} sessions from your past traffic are now part of the record, from ${input.eventsPersisted} events.`;
}

// Built from the stored CODE, never from the vendor's message: that string carries
// internal ids and is not ours to show anyone.
export function slackDisconnectedSentence(reasonCode: PostFailureCode | null): string {
  const what =
    reasonCode === "not_authorised" || reasonCode === "rejected"
      ? "Slack stopped accepting this workspace's connection"
      : reasonCode === "channel_unavailable"
        ? "The channel we deliver to is no longer available"
        : "Slack couldn't be reached";

  return `${what}, so findings aren't landing in your channel. Reconnect Slack in settings — anything missed will be delivered once it's back.`;
}

export interface AnalysisFailingSentenceInput {
  readonly failed: number;

  readonly of: number;
  readonly projectName: string;
}

export function analysisFailingSentence(input: AnalysisFailingSentenceInput): string {
  return `${input.failed} of the last ${input.of} checks on ${input.projectName} didn't finish. We'll keep trying, and your data is untouched.`;
}
