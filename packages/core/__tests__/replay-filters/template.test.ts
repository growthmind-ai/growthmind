import { describe, expect, it } from "bun:test";

import { fill } from "../../src/replay-filters/template";

describe("fill", () => {
  it("should substitute every token it has a value for", () => {
    expect(fill("{count} of {total} sessions", { count: "3", total: "47" })).toBe(
      "3 of 47 sessions",
    );
  });

  it("should leave a token with no value as written, never as the word undefined", () => {
    const filled = fill("{company} on {entry}", { company: "acme.example" });

    expect(filled).toBe("acme.example on {entry}");
    expect(filled).not.toContain("undefined");
  });

  it("should not re-expand a brace token that arrived inside a value", () => {
    expect(fill("{entry}", { entry: "/{company}/pricing", company: "acme.example" })).toBe(
      "/{company}/pricing",
    );
  });

  it("should substitute an empty value rather than falling back to the token", () => {
    expect(fill("{company} sessions", { company: "" })).toBe(" sessions");
  });

  it("should leave a brace run that names no word alone", () => {
    expect(fill("{} and {two words}", { two: "x" })).toBe("{} and {two words}");
  });

  it("should replace every occurrence of a repeated token", () => {
    expect(fill("{lane} then {lane}", { lane: "real" })).toBe("real then real");
  });
});
