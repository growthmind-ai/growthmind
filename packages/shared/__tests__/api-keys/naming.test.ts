import { describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../onboarding/module-under-construction";

const OWNER = "ADD O-026 Wave 1, the api-keys/naming.ts task (D-4)";
const SOURCE_PATH = "packages/shared/src/api-keys/naming.ts";

type ApiKeyNameFor = (input: {
  readonly requested: string | null;
  readonly label: string | null;
  readonly now: Date;
}) => string;

const NOW = new Date("2026-08-04T00:00:00Z");

const loadApiKeyNameFor = (): Promise<ApiKeyNameFor> =>
  loadUnderConstruction<ApiKeyNameFor>({
    modulePath: underConstructionSpecifier(SOURCE_PATH),
    exportName: "apiKeyNameFor",
    ownedBy: OWNER,
  });

const source = (): string =>
  readSourceUnderConstruction({ repoRelativePath: SOURCE_PATH, ownedBy: OWNER });

describe("apiKeyNameFor — the one home for the minting name rule (D-4)", () => {
  test("should return the requested name verbatim when one is given", async () => {
    const apiKeyNameFor = await loadApiKeyNameFor();

    expect(apiKeyNameFor({ requested: " my key ", label: null, now: NOW })).toBe("my key");
    expect(apiKeyNameFor({ requested: " my key ", label: "Cursor", now: NOW })).toBe("my key");
  });

  test("should fall through to the label when the requested name is blank", async () => {
    const apiKeyNameFor = await loadApiKeyNameFor();

    expect(apiKeyNameFor({ requested: "   ", label: "Cursor", now: NOW })).toBe(
      "Cursor (2026-08-04)",
    );
    expect(apiKeyNameFor({ requested: "", label: null, now: NOW })).toBe(
      "read credential (2026-08-04)",
    );
  });

  test("should name a key from the assistant and the date when a label is given", async () => {
    const apiKeyNameFor = await loadApiKeyNameFor();

    expect(apiKeyNameFor({ requested: null, label: "Cursor", now: NOW })).toBe(
      "Cursor (2026-08-04)",
    );
    expect(
      apiKeyNameFor({
        requested: null,
        label: "Claude Code",
        now: new Date("2027-01-09T23:59:59Z"),
      }),
    ).toBe("Claude Code (2027-01-09)");
  });

  test("should keep the CLI's default name byte-identical", async () => {
    const apiKeyNameFor = await loadApiKeyNameFor();

    // scripts/mint-api-key.ts:102-104 produced exactly this before the rule moved here.
    expect(apiKeyNameFor({ requested: null, label: null, now: NOW })).toBe(
      "read credential (2026-08-04)",
    );
    expect(
      apiKeyNameFor({ requested: null, label: null, now: new Date("2027-01-09T23:59:59Z") }),
    ).toBe("read credential (2027-01-09)");
  });

  test("should take the clock as a parameter and never read it itself", async () => {
    const apiKeyNameFor = await loadApiKeyNameFor();

    const inputs = [
      { requested: " my key ", label: null, now: NOW },
      { requested: null, label: "Cursor", now: NOW },
      { requested: null, label: null, now: NOW },
    ];

    for (const input of inputs) {
      expect(apiKeyNameFor(input)).toBe(apiKeyNameFor(input));
    }

    const text = source();
    expect(text).not.toContain("Date.now");
    expect(text).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });
});
