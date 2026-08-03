import { SLACK_CONNECTION_FIELDS, type FieldDescriptor } from "@growthmind/shared";

// The three facts every mount of the card is parameterised by (AD-4).
export interface SlackCardFacts {
  readonly channelId: string | null;
  readonly slackWorkspaceAttached: boolean;
  readonly slackWorkspaceName: string | null;
  readonly slackOAuthAvailable: boolean;
}

export interface SlackCardProps extends SlackCardFacts {
  readonly fields: readonly FieldDescriptor[];
  readonly settled: boolean;
  readonly interactive: boolean;
  readonly skippable: boolean;
  readonly skipped: boolean;
}

export function slackFields(): readonly FieldDescriptor[] {
  if (SLACK_CONNECTION_FIELDS.length === 0) {
    throw new Error(
      "SLACK_CONNECTION_FIELDS is empty. The pasted-token path is the only way to connect a " +
        "self-hosted install, and an empty field list renders it as a card with no inputs.",
    );
  }

  return SLACK_CONNECTION_FIELDS;
}

// Setup's step 3 mid-flow: unsettled, interactive, and skippable.
export const stepCardProps = (facts: SlackCardFacts): SlackCardProps => ({
  fields: slackFields(),
  settled: false,
  interactive: true,
  skippable: true,
  skipped: false,
  ...facts,
});
