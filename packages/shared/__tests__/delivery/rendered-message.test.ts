import { describe, expect, it } from "bun:test";

import {
  RENDERED_MESSAGE_VERSION,
  parseRenderedMessage,
  renderedMessageSchema,
  type RenderedMessage,
} from "../../src/delivery/rendered-message";

const VALID: RenderedMessage = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [
    { kind: "section", text: "*/checkout*\nThe payment step is losing sessions" },
    { kind: "context", text: "Counted 28 of the 30 sessions we looked at." },
    {
      kind: "actions",
      blockId: "finding:abc",
      actions: [
        { actionId: "get_it_fixed", label: "Get it fixed", value: "abc", style: "primary" },
        { actionId: "not_useful", label: "Not useful", value: "abc", style: null },
      ],
    },
  ],
  text: "/checkout\nThe payment step is losing sessions",
  legibility: { characters: 44, lines: 2 },
};

describe("the stored render is read back or refused, never guessed at", () => {
  it("accepts the shape the renderer produces", () => {
    expect(renderedMessageSchema.parse(VALID)).toEqual(VALID);
  });

  it("answers null for a delivery that predates the column", () => {
    expect(parseRenderedMessage(null)).toBeNull();
    expect(parseRenderedMessage(undefined)).toBeNull();
  });

  it("answers null rather than a half-message when the stored shape is not one we wrote", () => {
    // A jsonb column holds every shape ever written to it. A reader that trusted the declared
    // type here would hand a page a message with no blocks and call it what Slack carried.
    expect(parseRenderedMessage({ text: "hello" })).toBeNull();
    expect(parseRenderedMessage({ ...VALID, blocks: [] })).toBeNull();
    expect(parseRenderedMessage({ ...VALID, version: 99 })).toBeNull();
    expect(parseRenderedMessage("a string that was never a message")).toBeNull();
  });

  it("refuses a block kind it has no way to render", () => {
    expect(parseRenderedMessage({ ...VALID, blocks: [{ kind: "image", text: "x" }] })).toBeNull();
  });
});
