import type { SlackBlock } from "../delivery/slack-message";

export interface DigestMessageInput {
  // Already built by the per-type builders in `sentence.ts`, so no sentence is authored a
  // second time here. Capped at the bell's list limit by the caller.
  readonly sentences: readonly string[];

  // Of the whole window, not of the list: the denominator has to be the count of the week
  // the summary describes, so "20 of 27" stays honest at any list length.
  readonly totalCount: number;
}

export interface DigestMessage {
  readonly blocks: readonly SlackBlock[];
  readonly fallbackText: string;
}

export function digestLeadSentence(_shown: number, _total: number): string {
  throw new Error("O-051 job 2: not implemented");
}

export function buildDigestMessage(_input: DigestMessageInput): DigestMessage {
  throw new Error("O-051 job 2: not implemented");
}
