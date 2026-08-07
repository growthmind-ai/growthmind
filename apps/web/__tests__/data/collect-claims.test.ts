import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EXCLUSION_RULE_SET_VERSION,
  PROVIDER_CATALOGUE,
  URL_PATH_NORMALISATION_VERSION,
} from "@growthmind/shared";

import {
  DATA_GROUPS,
  DATA_PAGE_CLOSING,
  DATA_PAGE_LEDE,
  NOTHING_SEEN_NOTE,
  NOTHING_SEEN_RECEIPT,
  NO_COUNTS_NOTE,
} from "../../components/data/statements";

const WEB = join(import.meta.dir, "..", "..");

// Every file a sentence a reader sees can be written in. The prose moved off a JSON fixture
// into a descriptor module and the component that renders it, so the scan moved with it —
// a guard pointed at the surface's old home stops covering it silently.
const SOURCES: readonly string[] = [
  join(WEB, "app", "(app)", "data", "page.tsx"),
  join(WEB, "components", "data", "statements.ts"),
  join(WEB, "components", "data", "DataGroups.tsx"),
];

/** Everything a reader of /data sees: the statements, and the prose the page wraps them in. */
function pageText(): string {
  const statements = DATA_GROUPS.flatMap((group) => group.statements).map(
    (statement) => statement.text,
  );

  return [
    ...statements,
    DATA_PAGE_LEDE,
    DATA_PAGE_CLOSING,
    NO_COUNTS_NOTE,
    NOTHING_SEEN_NOTE,
    NOTHING_SEEN_RECEIPT,
    ...SOURCES.map((path) => readFileSync(path, "utf8")),
  ].join("\n");
}

function versionOf(label: string): string | undefined {
  const group = DATA_GROUPS.find((entry) => entry.label === label);
  if (group === undefined) throw new Error(`no group labelled "${label}"`);
  return group.stamp;
}

/** Each stamp the page is allowed to show, and the exported constant that decides it. */
const BOUND_VERSIONS: readonly { readonly label: string; readonly stamp: string }[] = [
  {
    label: "What we set aside",
    stamp: `exclusion rules v${String(EXCLUSION_RULE_SET_VERSION)}`,
  },
  {
    label: "What a recording keeps",
    stamp: `page address rules v${String(URL_PATH_NORMALISATION_VERSION)}`,
  },
];

const A_DATE = /\bsince\b|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

/**
 * Sentences the page carried while the code said otherwise. Each pairs the needle with the
 * condition that would license bringing it back, so the guard retires itself rather than
 * outliving the defect.
 */
const RETIRED: readonly {
  readonly claim: RegExp;
  readonly holdsWhen: () => boolean;
  readonly because: string;
}[] = [
  {
    claim: /shared across customers/i,
    holdsWhen: () => false,
    because: "no record crosses a workspace boundary — there is no cross-customer table to write",
  },
  {
    claim: /your code, read-only/i,
    holdsWhen: () => PROVIDER_CATALOGUE.some((entry) => entry.rail === "code" && entry.live),
    because: "no code provider is live, so nothing reads a repository",
  },
  {
    claim: /the recording is withheld/i,
    holdsWhen: () => false,
    because:
      "the confidence bar decides whether a finding is sent, not whether a recording is kept",
  },
  {
    claim: /never the characters/i,
    holdsWhen: () => false,
    because:
      "the count read from a recording counts key presses, which is not a count of characters",
  },
  {
    claim: /not written by hand/i,
    holdsWhen: () => false,
    because: "the page's statements are a hand-written file",
  },
];

describe("the /data page states only what the code does", () => {
  test("CONTROL: the scans catch their offender and clear its replacement", () => {
    expect(A_DATE.test("exclusion rules v1 · since 28 Jul")).toBe(true);
    expect(A_DATE.test("exclusion rules v1")).toBe(false);
    expect(A_DATE.test("page address rules v3")).toBe(false);

    for (const entry of RETIRED) {
      expect(entry.claim.test(pageText())).toBe(false);
    }
    expect(/shared across customers/i.test("goes into a record shared across customers")).toBe(
      true,
    );
  });

  test("the scan reaches every file a statement can be written in", () => {
    // A path that no longer exists would make the scan vacuously clean, which is the one way
    // this guard fails without failing.
    for (const path of SOURCES) {
      expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);
    }

    const scanned = pageText();
    expect(scanned).toContain("Bots, automated browsers and coding agents.");
    expect(scanned).toContain(DATA_PAGE_CLOSING);
  });

  test("every version the page shows is the one the code exports", () => {
    for (const { label, stamp } of BOUND_VERSIONS) {
      expect(versionOf(label)).toBe(stamp);
    }
  });

  test("no group shows a version stamp nothing in the code backs", () => {
    const bound = new Set(BOUND_VERSIONS.map((entry) => entry.label));
    const unbound = DATA_GROUPS.filter(
      (group) => group.stamp !== undefined && !bound.has(group.label),
    ).map((group) => `${group.label}: ${String(group.stamp)}`);

    expect(unbound).toEqual([]);
  });

  test("no statement carries an effective date, because no rule set records one", () => {
    const dated = DATA_GROUPS.flatMap((group) =>
      group.statements.map((statement) => statement.text).concat(group.stamp ?? ""),
    ).filter((line) => A_DATE.test(line));

    expect(dated).toEqual([]);
  });

  test("no retired claim is back while the code still contradicts it", () => {
    const text = pageText();
    const contradicted = RETIRED.filter(
      (entry) => entry.claim.test(text) && !entry.holdsWhen(),
    ).map((entry) => `"${entry.claim.source}" — ${entry.because}`);

    expect(contradicted).toEqual([]);
  });

  test("the guard bites — a claim present with its condition false is reported", () => {
    const planted = { claim: /Bots, automated browsers/, holdsWhen: (): boolean => false };
    expect(planted.claim.test(pageText()) && !planted.holdsWhen()).toBe(true);
  });
});
