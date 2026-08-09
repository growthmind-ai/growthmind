import { describe, expect, test } from "bun:test";

import { escapeMrkdwn, mrkdwnLength, mrkdwnPrefixLength } from "../../src/delivery/mrkdwn";

const PLAIN_TEXT = "ad-fake finding body";

// Moved here from block-kit.test.ts when the escape gained a second caller: the message ladder
// measures its budget on the escaped form, so the rule can no longer live inside the Block Kit
// converter.
describe("escapeMrkdwn", () => {
  test("an ampersand in an ordinary sentence still reads as an ampersand", () => {
    expect(escapeMrkdwn("Search & filter on /reports")).toBe("Search &amp; filter on /reports");
  });

  test("escapes each character once, so an escape is never escaped again", () => {
    expect(escapeMrkdwn("&lt;")).toBe("&amp;lt;");
    expect(escapeMrkdwn("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  test("leaves text with none of the three untouched", () => {
    expect(escapeMrkdwn(PLAIN_TEXT)).toBe(PLAIN_TEXT);
  });
});

describe("the length a budget has to be measured in", () => {
  test("an ampersand costs five on the wire, not one", () => {
    expect(mrkdwnLength("&&&")).toBe(15);
    expect(mrkdwnLength(PLAIN_TEXT)).toBe(PLAIN_TEXT.length);
  });

  test("no prefix is offered whose escaped form would not fit", () => {
    const budget = 12;
    const text = "&&&&&&&&&&";

    const taken = mrkdwnPrefixLength(text, budget);

    expect(taken).toBe(2);
    expect(mrkdwnLength(text.slice(0, taken))).toBeLessThanOrEqual(budget);
  });

  test("plain text keeps the whole prefix the budget allows", () => {
    expect(mrkdwnPrefixLength(PLAIN_TEXT, PLAIN_TEXT.length)).toBe(PLAIN_TEXT.length);
    expect(mrkdwnPrefixLength(PLAIN_TEXT, 4)).toBe(4);
  });
});
