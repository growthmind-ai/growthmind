import { RESIDUAL_PII_KINDS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import type { ScannedText } from "../../src/repositories/finding-text";
import type { FindingRecord } from "../../src/repositories/findings.repo";

const GATE_OWNER = "ADD Wave 1.2 (packages/db/src/repositories/finding-text.ts, Decision 2)";

const GATE_SOURCE_PATH = "packages/db/src/repositories/finding-text.ts";

const REPO_SOURCE_PATH = "packages/db/src/repositories/findings.repo.ts";

const OFFENDER = "jane.doe@acme.example";

const CLEAN_LINE = "Nineteen of twenty-eight visitors stopped before the last step.";

const DIRTY_LINE = `Nineteen of twenty-eight visitors stopped before the last step, and one wrote in as ${OFFENDER}.`;

// ADD Decision 2's `FindingText`. The production union lands in
// packages/core/src/delivery/finding-text.ts and is re-exported from the module below.
type Verdict =
  | { readonly held: false; readonly headline: string; readonly context: readonly string[] }
  | { readonly held: true; readonly why: "residual_pii"; readonly kind: string }
  | { readonly held: true; readonly why: "unreadable" };

type ReadFindingText = (row: { readonly headline: string; readonly context: unknown }) => Verdict;

// `why` and `kind` name a class; `at` is an offset. None of them can hold a fragment.
const VERDICT_KEYS = new Set(["held", "why", "kind", "at"]);

const loadReadFindingText = (): Promise<ReadFindingText> =>
  loadUnderConstruction<ReadFindingText>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/finding-text"),
    exportName: "readFindingText",
    ownedBy: GATE_OWNER,
  });

function wordsOf(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((word) => word.length >= 4),
    ),
  ];
}

const UNCOMPOSABLE_HEADLINE = {
  toString(): string {
    throw new Error("this value cannot be composed into text to scan");
  },
};

// The compile arm of U5. Never called; `bun run typecheck` is what reads it.
function scannedTextIsNotForgeable(record: FindingRecord): void {
  // @ts-expect-error a plain string is not ScannedText — only the mint may produce one
  const forged: ScannedText = OFFENDER;
  // @ts-expect-error FindingRecord no longer carries a bare headline
  const bare: string = record.headline;
  void forged;
  void bare;
}

describe("the read-time residual-PII gate", () => {
  test("a scan that throws is treated as dirty, never as clean", async () => {
    const readFindingText = await loadReadFindingText();

    const verdict = readFindingText({
      headline: UNCOMPOSABLE_HEADLINE as unknown as string,
      context: [CLEAN_LINE],
    });

    expect(verdict).toEqual({ held: true, why: "unreadable" });
    expect(verdict.held).toBe(true);
    expect("headline" in verdict).toBe(false);
    expect("context" in verdict).toBe(false);
  });

  test("a context that is not an array of strings is held as unreadable and never throws past the gate", async () => {
    const readFindingText = await loadReadFindingText();

    let verdict: Verdict | undefined;
    expect(() => {
      verdict = readFindingText({ headline: "x", context: { a: 1 } });
    }).not.toThrow();

    expect(verdict).toEqual({ held: true, why: "unreadable" });
  });

  test("an empty context scans clean and is not an error", async () => {
    const readFindingText = await loadReadFindingText();

    const verdict = readFindingText({ headline: "All good.", context: [] });

    expect(verdict.held).toBe(false);
    if (verdict.held) {
      throw new Error("expected text with nothing in it to scan clean, not to be held");
    }
    expect(verdict.context).toEqual([]);
    expect(verdict.headline).toBe("All good.");
  });

  test("a held verdict carries a kind and an offset and has nowhere to put the matched text", async () => {
    const readFindingText = await loadReadFindingText();

    const dirtyHeadline = readFindingText({ headline: DIRTY_LINE, context: [] });
    const dirtyContext = readFindingText({ headline: CLEAN_LINE, context: [DIRTY_LINE] });
    const unreadable = readFindingText({ headline: CLEAN_LINE, context: { a: 1 } });

    expect(dirtyHeadline).toMatchObject({ held: true, why: "residual_pii" });
    if (!dirtyHeadline.held || dirtyHeadline.why !== "residual_pii") {
      throw new Error("expected the planted offender to be classified as residual PII");
    }
    expect(RESIDUAL_PII_KINDS as readonly string[]).toContain(dirtyHeadline.kind);

    for (const verdict of [dirtyHeadline, dirtyContext, unreadable]) {
      expect(verdict.held).toBe(true);

      const serialised = JSON.stringify(verdict).toLowerCase();
      expect(serialised).not.toContain(OFFENDER.toLowerCase());
      for (const word of wordsOf(DIRTY_LINE)) {
        expect(serialised).not.toContain(word);
      }

      expect(Object.keys(verdict).filter((key) => !VERDICT_KEYS.has(key))).toEqual([]);
    }
  });

  test("a plain string cannot be assigned to ScannedText and FindingRecord carries no bare headline", () => {
    expect(typeof scannedTextIsNotForgeable).toBe("function");

    const gate = readSourceUnderConstruction({
      repoRelativePath: GATE_SOURCE_PATH,
      ownedBy: GATE_OWNER,
    });
    expect(gate).toContain("export function readFindingText");
    expect(gate).toContain("ScannedText");

    const repo = readSourceUnderConstruction({
      repoRelativePath: REPO_SOURCE_PATH,
      ownedBy: "ADD Wave 1.3 (packages/db/src/repositories/findings.repo.ts, Decision 3)",
    });
    expect(repo).toContain("readFindingText(");
    expect(repo).toMatch(/Omit<\s*FindingRow\s*,[^>]*"headline"/);
  });
});
