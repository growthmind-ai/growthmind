import { describe, expect, it } from "bun:test";

import { deriveWorkspaceName } from "../../src/index";

describe("deriveWorkspaceName", () => {
  it("derives \"Ada's workspace\" from the first word of the user's name", () => {
    expect(deriveWorkspaceName("Ada")).toBe("Ada's workspace");

    // Multi-word names use only the first word.
    expect(deriveWorkspaceName("Ada Lovelace")).toBe("Ada's workspace");
    expect(deriveWorkspaceName("Grace Hopper Jones")).toBe("Grace's workspace");
  });

  it('falls back to "Your workspace" when the name is empty, whitespace, or missing', () => {
    const inputs: Array<string | null | undefined> = ["", "   ", "\t\n", null, undefined];

    for (const input of inputs) {
      const result = deriveWorkspaceName(input);
      expect(result).toBe("Your workspace");
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain("undefined");
    }
  });
});
