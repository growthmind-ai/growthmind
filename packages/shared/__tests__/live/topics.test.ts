import { describe, expect, test } from "bun:test";

import { LIVE_TOPICS, livePayloadSchema, liveTopicSchema } from "../../src/live/topics";

describe("the topic a recording state change travels under", () => {
  test("recordings is a topic this build knows", () => {
    const topics: readonly string[] = LIVE_TOPICS;

    expect(topics.includes("recordings")).toBe(true);
  });

  test("recordings parses as a live topic rather than being refused", () => {
    const topic: string = liveTopicSchema.parse("recordings");

    expect(topic).toBe("recordings");
  });

  test("a recordings change carries the organization it belongs to and nothing more", () => {
    const parsed: { organizationId: string; topic: string } = livePayloadSchema.parse({
      organizationId: "org-a",
      topic: "recordings",
    });

    expect(parsed).toEqual({ organizationId: "org-a", topic: "recordings" });
  });

  // The singular is the typo a caller writes by hand; parsing has to refuse it, because a topic
  // nothing recognises is dropped in silence and the page never hears the change (D9).
  test("refuses the singular near-miss instead of dropping the change in silence", () => {
    expect(liveTopicSchema.safeParse("recording").success).toBe(false);
  });
});
