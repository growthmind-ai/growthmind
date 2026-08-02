import { describe, expect, test } from "bun:test";

import type { BuildPrivacyReceipt, PrivacyReceiptInput, ReceiptLine } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

const loadBuildPrivacyReceipt = (): Promise<BuildPrivacyReceipt> =>
  loadUnderConstruction<BuildPrivacyReceipt>({
    modulePath: "../../src/onboarding/privacy-receipt",
    exportName: "buildPrivacyReceipt",
    ownedBy: "ADD Wave 1, the onboarding/privacy-receipt.ts task",
  });

const WITH_DOMAIN: PrivacyReceiptInput = {
  inferredInternalDomain: "acme.example",
  provenance: "org_creator_email",
};

const WITHOUT_DOMAIN: PrivacyReceiptInput = {
  inferredInternalDomain: null,
  provenance: null,
};

const UNSHIPPED_CAPABILITY =
  /\bmask(?:ed|ing|s)?\b|\bredact\w*\b|\bscrub\w*\b|\banonymi[sz]\w*\b|\bencrypt\w*\b|\brecord(?:ing|s|ed)?\b|\breplay\w*\b|\bcaptur\w*\b|\bblur\w*\b|\bobfuscat\w*\b/i;

const lengthOf = (lines: readonly ReceiptLine[]): number => lines.length;

describe("buildPrivacyReceipt — AD-2, FR-O8, ruling R2", () => {
  test("the receipt renders seven lines", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();

    expect(lengthOf(buildPrivacyReceipt(WITH_DOMAIN))).toBe(7);
    expect(lengthOf(buildPrivacyReceipt(WITHOUT_DOMAIN))).toBe(7);

    expect(lengthOf(buildPrivacyReceipt(WITH_DOMAIN))).toBe(
      lengthOf(buildPrivacyReceipt(WITHOUT_DOMAIN)),
    );

    for (const line of buildPrivacyReceipt(WITH_DOMAIN)) {
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line.trim().endsWith(".")).toBe(true);
    }

    expect(buildPrivacyReceipt(WITH_DOMAIN)).toEqual([...buildPrivacyReceipt(WITH_DOMAIN)]);
  });

  test("the receipt exposes no editable control", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();
    const receipt = buildPrivacyReceipt(WITH_DOMAIN);

    for (const line of receipt) {
      expect(typeof line).toBe("string");
    }

    for (const line of receipt) {
      expect(line).not.toMatch(/\bswitch (?:this |it )?(?:on|off)\b/i);
      expect(line).not.toMatch(/\bturn (?:this |it )?(?:on|off)\b/i);
      expect(line).not.toMatch(/\bchange (?:this|it) (?:here|below)\b/i);
      expect(line).not.toMatch(/\bsetting(?:s)? (?:page|panel)\b/i);
    }
  });

  test("an org with no inferred internal domain says so and says why", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();

    const withDomain = buildPrivacyReceipt(WITH_DOMAIN);
    const withoutDomain = buildPrivacyReceipt(WITHOUT_DOMAIN);

    const differing = withDomain
      .map((line, index) => (line === withoutDomain[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(differing).toHaveLength(1);

    const substituted = withoutDomain[differing[0] ?? -1] ?? "";

    expect(substituted).toMatch(/could not|couldn't|were not able|was not able/i);

    expect(substituted).toMatch(/rather miss/i);
    expect(substituted).toMatch(/real users/i);

    expect(substituted).not.toMatch(/\berror\b|\bfailed\b|\binvalid\b/i);
  });

  test("an org with an inferred internal domain names the value and its provenance", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();
    const receipt = buildPrivacyReceipt(WITH_DOMAIN);

    const naming = receipt.filter((line) =>
      line.includes(WITH_DOMAIN.inferredInternalDomain ?? ""),
    );
    expect(naming).toHaveLength(1);

    expect(naming[0]).toMatch(/email/i);
    expect(naming[0]).not.toMatch(/org_creator_email/);

    const cut = buildPrivacyReceipt(WITHOUT_DOMAIN);
    expect(cut).toHaveLength(7);
    for (const line of cut) {
      expect(line.trim().endsWith(".")).toBe(true);
    }
  });

  test("no receipt line claims a capability packages/sdk-js does not have", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();

    expect("Your masking config was verified.").toMatch(UNSHIPPED_CAPABILITY);
    expect("We record every session so you can replay it.").toMatch(UNSHIPPED_CAPABILITY);

    expect("We keep no bag of event properties at all.").not.toMatch(UNSHIPPED_CAPABILITY);

    const offenders = [
      ...buildPrivacyReceipt(WITH_DOMAIN),
      ...buildPrivacyReceipt(WITHOUT_DOMAIN),
    ].filter((line) => UNSHIPPED_CAPABILITY.test(line));

    expect(offenders).toEqual([]);
  });
});
