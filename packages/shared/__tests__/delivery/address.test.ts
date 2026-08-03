// B-036: "not an address" was defined twice, in two packages, over the same three
// strings — and nothing failed if they drifted. The result of a drift is
// `deliveryState: "posted"` beside a render that returns null, or `#null` back on
// screen. These rows walk every consumer over one corpus.
import { describe, expect, test } from "bun:test";

import {
  isDeliveryAddress,
  NON_ADDRESS_SENTINELS,
  NON_ADDRESS_VALUES,
  TRIMMED_WHITESPACE,
} from "../../src/delivery/address";
import { renderDeliveryClosure, renderDeliveryLine } from "../../src/onboarding/stage-view";
import { STAGE_NO_DELIVERY_LINE } from "../../src/onboarding/messages";

const REAL_CHANNEL = "C01AB2CD3EF";

// The corpus B-036 names, plus the casing and padding a merge could drop.
export const NOT_ADDRESSES: readonly (string | null)[] = [
  null,
  "",
  " ",
  "   ",
  "\t",
  "\n",
  "null",
  "NULL",
  " null ",
  "Null",
  "undefined",
  "UNDEFINED",
  " undefined ",
];

export const ADDRESSES: readonly string[] = [
  REAL_CHANNEL,
  "  C01AB2CD3EF  ",
  "general",
  "C0NULL123",
];

describe("one definition of not-an-address (B-036)", () => {
  test("the shared predicate refuses every sentinel shape", () => {
    for (const value of NOT_ADDRESSES) {
      expect(`${JSON.stringify(value)}:${isDeliveryAddress(value)}`).toBe(
        `${JSON.stringify(value)}:false`,
      );
    }
  });

  test("it accepts a real address, including a padded one and one merely containing a sentinel", () => {
    // Control - a predicate that refused everything would pass the row above.
    for (const value of ADDRESSES) {
      expect(`${value}:${isDeliveryAddress(value)}`).toBe(`${value}:true`);
    }
  });

  test("undefined is refused, so a missing field is not an address either", () => {
    expect(isDeliveryAddress(undefined)).toBe(false);
  });

  test("the rendered delivery line agrees with both, on every value in the corpus", () => {
    for (const value of [...NOT_ADDRESSES, ...ADDRESSES]) {
      const rendered = renderDeliveryLine("posted", value) !== null;

      expect(`${JSON.stringify(value)} rendered=${rendered}`).toBe(
        `${JSON.stringify(value)} rendered=${isDeliveryAddress(value)}`,
      );
    }
  });

  test("a sentinel address closes with nowhere-to-deliver rather than a channel name", () => {
    for (const value of NOT_ADDRESSES) {
      expect(renderDeliveryClosure("posted", value)).toBe(STAGE_NO_DELIVERY_LINE);
    }

    // Control - a real address still produces the delivered sentence.
    expect(renderDeliveryClosure("posted", REAL_CHANNEL)).not.toBe(STAGE_NO_DELIVERY_LINE);
    expect(renderDeliveryClosure("posted", REAL_CHANNEL)).toContain(REAL_CHANNEL);
  });

  test("the rendered channel is trimmed, so padding never reaches the sentence", () => {
    expect(renderDeliveryLine("posted", `  ${REAL_CHANNEL}  `)).toContain(`#${REAL_CHANNEL}`);
    expect(renderDeliveryLine("posted", `  ${REAL_CHANNEL}  `)).not.toContain(`# ${REAL_CHANNEL}`);
  });

  // Re-derived from `.trim()` rather than restated: a JS revision that widens the set
  // fails here rather than silently in Postgres, where this string is `btrim`s argument.
  test("the shared trim set is exactly what String.prototype.trim removes", () => {
    const removed = [...Array(0x110000).keys()]
      .filter((code) => code < 0xd800 || code > 0xdfff)
      .filter((code) => {
        const ch = String.fromCodePoint(code);
        return `${ch}x${ch}`.trim() === "x";
      })
      .map((code) => String.fromCodePoint(code));

    expect([...TRIMMED_WHITESPACE].toSorted()).toEqual(removed.toSorted());
  });

  test("every trimmed character makes a value blank, and none of them is an address", () => {
    for (const ch of TRIMMED_WHITESPACE) {
      const point = `U+${ch.codePointAt(0)?.toString(16).padStart(4, "0")}`;

      expect(`${point}:${isDeliveryAddress(ch)}`).toBe(`${point}:false`);
      expect(`${point}:${isDeliveryAddress(`${ch}null${ch}`)}`).toBe(`${point}:false`);
      // Control - the same character around a real id leaves it an address.
      expect(`${point}:${isDeliveryAddress(`${ch}C01AB2CD3EF${ch}`)}`).toBe(`${point}:true`);
    }
  });

  test("the SQL guard's list is the predicate's list plus the empty string", () => {
    // The third home is `attachChannel`'s fill guard, which is SQL and cannot call
    // a predicate. It consumes this list, so a sentinel added here widens it too.
    expect([...NON_ADDRESS_VALUES]).toEqual(["", ...NON_ADDRESS_SENTINELS]);

    for (const value of NON_ADDRESS_VALUES) {
      expect(`${JSON.stringify(value)}:${isDeliveryAddress(value)}`).toBe(
        `${JSON.stringify(value)}:false`,
      );
    }
  });
});
