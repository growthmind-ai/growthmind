import { describe, expect, test } from "bun:test";

import { guardCauseText } from "../../src/cause/guard";

function claim(statement: string): { readonly statement: string } {
  return { statement };
}

describe("guardCauseText — §6 prohibitions, one fixture per prohibition", () => {
  test("should refuse a claim whose statement contains a bare digit", () => {
    const verdict = guardCauseText([claim("This happened 3 times.")]);

    expect(verdict.ok).toBe(false);
  });

  test("should refuse a claim whose statement contains a percentage", () => {
    const verdict = guardCauseText([claim("40% of people gave up here.")]);

    expect(verdict.ok).toBe(false);
    // not silently stripped of the % token and republished — refusal is whole-response
    if (verdict.ok) return;
    expect(verdict.offences.length).toBeGreaterThan(0);
  });

  test("should refuse a claim whose statement names a date without a digit", () => {
    const verdict = guardCauseText([claim("This happened last Tuesday.")]);

    expect(verdict.ok).toBe(false);
  });

  test("should refuse a claim whose statement names a time span without a digit", () => {
    const verdict = guardCauseText([claim("They waited a few minutes before leaving.")]);

    expect(verdict.ok).toBe(false);
  });

  test("should refuse a claim whose statement contains a confidence or severity word", () => {
    const verdict = guardCauseText([claim("This was probably the cause.")]);

    expect(verdict.ok).toBe(false);
  });
});

describe("guardCauseText — causal language is granted, unlike guardModelText's SAC-7", () => {
  test("should accept a claim using causal connectives that guardModelText's SAC-7 would reject", () => {
    const verdict = guardCauseText([
      claim(
        "The request failed because the field was empty, which meant the form could not submit.",
      ),
    ]);

    expect(verdict).toEqual({ ok: true });
  });
});

describe("guardCauseText — whole-response refusal, never per-claim trimming", () => {
  test("should refuse the whole response when only one of several claims offends", () => {
    const cleanClaim = claim("The request failed because the field was left empty.");
    const offendingClaim = claim("This happened 3 times before they gave up.");

    const verdict = guardCauseText([cleanClaim, offendingClaim]);

    // the clean claim is not silently kept — the whole response is refused
    expect(verdict.ok).toBe(false);
  });
});
