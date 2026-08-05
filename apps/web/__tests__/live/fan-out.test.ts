import { livePayloadSchema, type LiveTopic } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { fanOut, type LiveListener } from "../../lib/live/hub";

function registry(entries: Record<string, readonly LiveListener[]>) {
  return new Map(Object.entries(entries).map(([org, listeners]) => [org, new Set(listeners)]));
}

const swallow = (): void => undefined;

describe("handing a change to the readers waiting for it", () => {
  test("tells every reader in the organization, not only the one who caused it", () => {
    const heard: string[] = [];

    fanOut(
      registry({ "org-a": [() => heard.push("first"), () => heard.push("second")] }),
      { organizationId: "org-a", topic: "business_context" },
      swallow,
    );

    expect(heard).toEqual(["first", "second"]);
  });

  // One channel carries every organization's changes, so this filter is the whole tenant
  // boundary on the live surface (D7).
  test("tells nobody outside the organization the change belongs to", () => {
    const heard: string[] = [];

    fanOut(
      registry({ "org-a": [() => heard.push("mine")], "org-b": [() => heard.push("theirs")] }),
      { organizationId: "org-a", topic: "business_context" },
      swallow,
    );

    expect(heard).toEqual(["mine"]);
  });

  test("a change for an organization nobody is watching is not an error", () => {
    expect(() =>
      fanOut(registry({}), { organizationId: "org-a", topic: "findings" }, swallow),
    ).not.toThrow();
  });

  test("one reader throwing does not cost the others the change", () => {
    const heard: string[] = [];
    const failures: unknown[] = [];

    fanOut(
      registry({
        "org-a": [
          () => {
            throw new Error("this reader is broken");
          },
          () => heard.push("still told"),
        ],
      }),
      { organizationId: "org-a", topic: "business_context" },
      (error) => failures.push(error),
    );

    expect(heard).toEqual(["still told"]);
    expect(failures).toHaveLength(1);
  });

  test("passes the topic through, so a page can ignore changes it does not show", () => {
    const topics: LiveTopic[] = [];

    fanOut(
      registry({ "org-a": [(topic) => topics.push(topic)] }),
      { organizationId: "org-a", topic: "agent_connection" },
      swallow,
    );

    expect(topics).toEqual(["agent_connection"]);
  });
});

describe("the payload a change travels as", () => {
  test("carries what changed and never what it changed to", () => {
    const parsed = livePayloadSchema.parse({
      organizationId: "org-a",
      topic: "business_context",
    });

    expect(Object.keys(parsed).toSorted()).toEqual(["organizationId", "topic"]);
  });

  test("refuses a topic this build does not know rather than passing it on", () => {
    expect(
      livePayloadSchema.safeParse({ organizationId: "org-a", topic: "something_else" }).success,
    ).toBe(false);
  });

  test("refuses a change that names no organization, which nothing could address", () => {
    expect(livePayloadSchema.safeParse({ topic: "findings" }).success).toBe(false);
  });
});
