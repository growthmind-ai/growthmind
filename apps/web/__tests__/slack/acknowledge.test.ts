import { describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

type SlackAcknowledgementUrlPredicate = (candidate: string) => boolean;

const OWNED_BY = "ADD Wave 6 (Decision R-7), apps/web/lib/slack/acknowledge.ts";

const loadAllowList = (): Promise<SlackAcknowledgementUrlPredicate> =>
  loadUnderConstruction<SlackAcknowledgementUrlPredicate>({
    modulePath: underConstructionSpecifier("apps/web/lib/slack/acknowledge.ts"),
    exportName: "isSlackAcknowledgementUrl",
    ownedBy: OWNED_BY,
  });

const REFUSED: readonly string[] = [
  "http://hooks.slack.com/actions/T00000000/1234567890/abcdefghijklmnop",
  "https://hooks.slack.com.evil.test/actions/T00000000/1234567890/abcdefghijklmnop",
  "https://evil.test/actions/T00000000/1234567890/abcdefghijklmnop",
  "https://evil.test/?next=https://hooks.slack.com/actions/T0/1/a",
  "https://hooks.slack.com@evil.test/actions/T0/1/a",
  "https://HOOKS.SLACK.COM.evil.test/actions/T0/1/a",
  "https://hooks.slack.com:8443/actions/T0/1/a",
  "https://hooks.slack.com./actions/T0/1/a",
  "",
  "not-a-url",
];

const ACCEPTED: readonly string[] = [
  "https://hooks.slack.com/actions/T00000000/1234567890/abcdefghijklmnop",
  "https://hooks.slack.com/actions/T99999999/9999999999/zyxwvutsrqponmlk",
];

describe("the acknowledgement host allow-list", () => {
  test("refuses an acknowledgement URL that is not Slack's", async () => {
    const isSlackAcknowledgementUrl = await loadAllowList();

    for (const candidate of REFUSED) {
      expect({ candidate, allowed: isSlackAcknowledgementUrl(candidate) }).toEqual({
        candidate,
        allowed: false,
      });
    }

    for (const candidate of ACCEPTED) {
      expect({ candidate, allowed: isSlackAcknowledgementUrl(candidate) }).toEqual({
        candidate,
        allowed: true,
      });
    }
  });
});
