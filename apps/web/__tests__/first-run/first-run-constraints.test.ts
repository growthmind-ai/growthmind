// DEVIATION 1, MADE TESTABLE — task 0g.2. ADD §9, 4 rows. FR-O21, AC-O26,
// FR-O2, AD-17, AD-18.
//
// ###########################################################################
// # THE RULE THIS FILE ENFORCES IS ABSOLUTE, AND IT IS A PRODUCT DECISION.
// #
// # `docs/mvp.md` §7 deviation 1: THE FIRST-RUN SURFACE EXISTS ONCE, DURING
// # INSTALL, WHILE THE USER IS PRESENT. IT IS NEVER LINKABLE BACK TO AND IT
// # HOLDS NO HISTORY.
// #
// # `docs/product-decisions.md` §10 is non-dashboard BY PRINCIPLE, and the UX
// # spec names the anti-persona explicitly: the dashboard-checker. "No findings
// # list, no history, no metric tiles, ever." UX row 20's own retire line says
// # it to the customer in the product's voice — "This screen retires with setup
// # — there is nothing here to come back and check."
// #
// # ANYTHING RESEMBLING A FINDINGS LIST IS A DESIGN BUG. Not a scope question,
// # not a P1, not a "we could add it later" — `AGENTS.md` is explicit that a PR
// # violating a product decision is declined regardless of code quality.
// ###########################################################################
//
// THIS SUITE ASSERTS THE NEGATIVE SPACE, WHICH IS THE HARD HALF. A positive
// assertion ("the surface renders the finding") fails loudly the day somebody
// breaks it. A negative one ("nothing links back") has no natural failure:
// adding a nav item to `/first-run` breaks no type, fails no render, and looks
// like a helpful improvement in review. The four rows below are the only thing
// standing between deviation 1 and a well-meaning pull request.
//
// TWO SCANS, ONE LITERAL, TWO OWNERS — COORDINATED, NOT DUPLICATED. Wave 0f's
// `apps/web/__tests__/routes.test.ts` also scans for the literal `/first-run`,
// for a DIFFERENT reason: EC-O9's "a route path goes in `ROUTES`, never
// retyped", which is a D9 typo guard. This file scans for `ROUTES.firstRun`
// AND the literal, for deviation 1, and carries one exemption 0f's does not:
// `apps/web/app/page.tsx`, whose dismissal-gated CTA is the single sanctioned
// reference (AD-17). This file is the deviation-1 authority; the two lists are
// compatible by construction and the difference is stated here so neither
// drifts silently.
//
// EVERY ROW IS RED TODAY, AND EACH FOR A DIFFERENT KIND OF ABSENCE:
//   - row 1 — `ROUTES.firstRun` is not registered yet (Wave 6).
//   - row 2 — `packages/shared/src/onboarding/types.ts` does not exist (Wave 1a).
//   - rows 3 and 4 — `apps/web/app/page.tsx` EXISTS and says something else.
//     Those two are red on CONTENT, which is the honest shape of "the comment
//     must be UPDATED" and "the CTA must be GATED".
import { describe, expect, test } from "bun:test";

import type { FirstRunStatus } from "../../../../packages/shared/__tests__/onboarding/contract-shapes";
import { readSourceUnderConstruction } from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  blankComments,
  commentsOnly,
  FIRST_RUN_TREE,
  fixture,
  fixtureAt,
  LANDING_PAGE,
  offenders,
  readAll,
  readExisting,
  readFirstRun,
  webSources,
  type ScannedFile,
} from "./helpers/first-run-source";

const OWNER_TYPES = "ADD Wave 1a, task 1a.1 (packages/shared/src/onboarding/types.ts, AD-18/B5)";
const OWNER_ROUTES = "ADD Wave 6 (apps/web/lib/routes.ts, AD-17)";

// ===========================================================================
// Row 1 — nothing links back
// ===========================================================================

/**
 * Every reference to the onboarding surface, in either encoding.
 *
 * BOTH ENCODINGS, because a guard pinned to one of them is the D9 failure:
 * `ROUTES.firstRun` is the sanctioned form and the raw literal is what somebody
 * types when they are in a hurry, and either one puts a link on the screen.
 */
const SURFACE_REFERENCE = /ROUTES\.firstRun|["'`]\/first-run\b/;

/**
 * The paths allowed to name the surface, and why each one is.
 *
 * This is the whole of deviation 1's exemption list. It is deliberately tiny
 * and every entry is justified — an allow-list that grows by one entry per
 * convenience is how a "nothing links back" rule becomes decoration.
 */
const EXEMPT: readonly { readonly path: RegExp; readonly why: string }[] = [
  { path: /^apps\/web\/lib\/routes\.ts$/, why: "the registration itself (AD-17, EC-O9)" },
  { path: /^apps\/web\/app\/\(first-run\)\//, why: "the surface's own route tree" },
  { path: /^apps\/web\/components\/first-run\//, why: "the surface's own components" },
  { path: /^apps\/web\/app\/api\/first-run\//, why: "the surface's own routes (AD-16)" },
  { path: /^apps\/web\/lib\/first-run\//, why: "the surface's own boundary helpers" },
  {
    path: /^apps\/web\/app\/page\.tsx$/,
    why: "THE ONE SANCTIONED LINK — the dismissal-gated CTA (FR-O2, AD-17). Row 3 proves the gate",
  },
];

const isExempt = (file: string): boolean => EXEMPT.some(({ path }) => path.test(file));

/** References from files that are NOT allowed to make them. */
const unsanctionedLinks = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(
    files.filter((scanned) => !isExempt(scanned.file)),
    SURFACE_REFERENCE,
  );

/**
 * THE OFFENDER LIVES AT A NON-EXEMPT PATH, DELIBERATELY.
 *
 * `fixture()` puts its file inside `apps/web/components/first-run/`, which this
 * particular scan EXEMPTS — so a planted offender built with it would be a
 * control that cannot fail. The realistic edit is a shared nav or a settings
 * link somewhere else in the app, and that is where this one sits.
 */
const PLANTED_NAV = fixtureAt(
  "apps/web/components/landing/nav.tsx",
  `import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export function Nav() {
  return (
    <nav>
      <Link href={ROUTES.home}>Home</Link>
      <Link href={ROUTES.firstRun}>Setup</Link>
      <Link href="/first-run">Setup again</Link>
    </nav>
  );
}
`,
);

const CLEAN_NAV = fixtureAt(
  "apps/web/components/landing/nav.tsx",
  `import Link from "next/link";
import { ROUTES } from "@/lib/routes";

// Deviation 1: there is no way back to the first-run surface, on purpose.
// A link here would read as helpful and would be the product decision broken.
export function Nav() {
  return (
    <nav>
      <Link href={ROUTES.home}>Home</Link>
    </nav>
  );
}
`,
);

// ===========================================================================
// Row 2 — no list of past findings
// ===========================================================================

/**
 * A `.map(` whose receiver names findings — the shape a history list takes.
 *
 * Deliberately receiver-scoped. The surface legitimately maps over five step
 * descriptors, over the counter's rows, over the receipt's lines and over the
 * wait log's entries; banning `.map(` outright would ban the whole render.
 */
const FINDINGS_MAP = /\b[\w.]*[Ff]inding[\w.]*\s*(\?\.)?\s*\.?\s*map\s*\(/;

/** A collection TYPE where AD-18 requires a single nullable object. */
const FINDINGS_ARRAY = /(?:readonly\s+)?OnboardingFinding\s*\[\]|Array<\s*OnboardingFinding\s*>/;

const findingsListIn = (files: readonly ScannedFile[]): readonly string[] => [
  ...offenders(files, FINDINGS_MAP),
  ...offenders(files, FINDINGS_ARRAY),
];

const PLANTED_FINDINGS_LIST = fixture(
  "PlantedFindingsList",
  `export function PastFindings({ findings }: { findings: readonly OnboardingFinding[] }) {
  return <Stack>{findings.map((finding) => <FindingCard key={finding.headline} finding={finding} />)}</Stack>;
}
`,
);

const CLEAN_FINDING_SLOT = fixture(
  "CleanFindingSlot",
  `export function Payoff({ finding }: { finding: OnboardingFinding | null }) {
  if (finding === null) return null;
  return <FindingCard finding={finding} />;
}
`,
);

/**
 * A TYPE-LEVEL PIN ON THE MIRROR, and it is honest about what it proves.
 *
 * `contract-shapes.ts` declares `FirstRunStatus.finding` as a single nullable
 * object because AD-18 does. This line makes that a compile error to change
 * HERE. It does NOT bind Wave 1a's real `types.ts` — the mirror casts, as its
 * own header says. The scan below is what binds the implementation.
 */
type FindingFieldIsNotAList = FirstRunStatus["finding"] extends readonly unknown[] ? never : true;
const FINDING_FIELD_IS_NOT_A_LIST: FindingFieldIsNotAList = true;

// ===========================================================================
// Rows 3 and 4 — the landing page
// ===========================================================================

/**
 * The CTA is rendered inside a branch that requires the user has NOT dismissed.
 *
 * A window rather than an exact structure, because the gate has several honest
 * shapes (`{dismissed ? … : <Cta />}`, `if (dismissed) return <Terminal />`, an
 * early `&&`). What every honest shape shares is that a dismissal fact is
 * consulted in the same neighbourhood as the link. What the OFFENDER looks like
 * is an unconditional CTA, and no window size hides that.
 */
const DISMISSAL_GATE =
  /(?:!\s*\w*[Dd]ismissed|\w*[Dd]ismissed\s*(?:===|!==)\s*(?:false|true)|\w*[Dd]ismissed\s*\?)[\s\S]{0,1200}?ROUTES\.firstRun/;

const ctaIsGated = (source: string): boolean => DISMISSAL_GATE.test(blankComments(source));

const PLANTED_UNGATED_CTA = fixture(
  "PlantedLanding",
  `export default async function Home() {
  const ctx = await getTenantContext();
  return (
    <Stack>
      <Text>Your workspace is ready.</Text>
      <Button component={Link} href={ROUTES.firstRun}>Set up Growthmind</Button>
    </Stack>
  );
}
`,
);

const CLEAN_GATED_CTA = fixture(
  "CleanLanding",
  `export default async function Home() {
  const ctx = await getTenantContext();
  const dismissed = await createFirstRunRepo(getDb(), ctx).isDismissed(ctx.userId);

  return (
    <Stack>
      <Text>Your workspace is ready.</Text>
      {dismissed ? (
        <Text>{LANDING_MESSAGES.setUpAlready}</Text>
      ) : (
        <Button component={Link} href={ROUTES.firstRun}>{LANDING_MESSAGES.setUpCta}</Button>
      )}
    </Stack>
  );
}
`,
);

/**
 * The three claims FR-O2 requires the honesty comment to still be making.
 *
 * `apps/web/app/page.tsx:64-66` today reads: *"Honesty rule (UX §3, binding):
 * plain text, not a button or link — nothing unbuilt is clickable. Becomes the
 * CTA in O-003."* Two thirds of that goes stale the moment this sprint ships:
 * the CTA IS built, and the rule it states now governs the two stubs on the new
 * surface rather than this line. **The correct edit is to UPDATE it** — deleting
 * it would delete the only place in the tree where the rule is written down at
 * the point of temptation.
 */
const HONESTY_CLAIMS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "it is still named as the binding honesty rule", pattern: /honesty rule/i },
  { name: "it records that the CTA is now built", pattern: /\bCTA\b/ },
  { name: "it names the stubs the rule now governs", pattern: /\bstubs?\b/i },
];

const missingHonestyClaims = (source: string): readonly string[] => {
  const comments = commentsOnly(source);
  return HONESTY_CLAIMS.filter(({ pattern }) => !pattern.test(comments)).map(({ name }) => name);
};

const PLANTED_DELETED_COMMENT = fixture(
  "PlantedDeletedComment",
  `export default async function Home() {
  return <Button component={Link} href={ROUTES.firstRun}>Set up Growthmind</Button>;
}
`,
);

const CLEAN_UPDATED_COMMENT = fixture(
  "CleanUpdatedComment",
  `export default async function Home() {
  return (
    <>
      {/* Honesty rule (UX §3, binding): this line was plain text because
          nothing unbuilt is clickable. The CTA is now BUILT, so it is a real
          button — and the same rule now governs the two stubs on the first-run
          surface, which render no control at all (FR-O2, FR-O3, FR-O15). */}
      <Button component={Link} href={ROUTES.firstRun}>Set up Growthmind</Button>
    </>
  );
}
`,
);

// ###########################################################################
describe("deviation 1 — the surface nothing links back to (FR-O21, AC-O26)", () => {
  // -------------------------------------------------------------- §9 row 1
  // Covers First-Run Checklist row 27.
  test("no route or rendered anchor targets the onboarding surface after completion", () => {
    // BOTH CONTROLS FIRST. This row's whole job is to report an empty list, so
    // a scanner that could not match would report deviation 1 kept forever.
    expect(unsanctionedLinks([PLANTED_NAV])).not.toEqual([]);
    expect(unsanctionedLinks([PLANTED_NAV])).toHaveLength(2);
    expect(unsanctionedLinks([CLEAN_NAV])).toEqual([]);

    // The exemption is by PATH, so the same offending source is silent when it
    // is the surface's own file — otherwise the surface could not link to
    // itself and the whole tree would fail its own rule.
    const asSurfaceFile = fixtureAt(
      "apps/web/components/first-run/FirstRunClient.tsx",
      PLANTED_NAV.source,
    );
    expect(unsanctionedLinks([asSurfaceFile])).toEqual([]);

    // ...and the single sanctioned exemption really is exempt. `page.tsx` is
    // the one file allowed to name the surface, and row 3 proves the gate that
    // makes it honest — the two rows are halves of one guarantee.
    expect(unsanctionedLinks([fixtureAt("apps/web/app/page.tsx", PLANTED_NAV.source)])).toEqual([]);

    // Every exemption states why it is one. An unexplained entry is how this
    // list stops being tiny.
    for (const { why } of EXEMPT) expect(why.trim().length).toBeGreaterThan(0);

    // NON-VACUITY ON THE REAL WALK. An empty result from a walk that found no
    // files would pass this row while proving nothing at all.
    const sources = webSources();
    expect(sources.length).toBeGreaterThan(10);

    // THE SURFACE MUST ACTUALLY EXIST TO BE UNREACHABLE. Without this the row
    // is green on today's tree for the wrong reason — nothing links to
    // `/first-run` because there is no `/first-run`.
    const routes = readExisting("apps/web/lib/routes.ts");
    if (!/\bfirstRun\s*:/.test(blankComments(routes.source))) {
      throw new Error(
        `NOT IMPLEMENTED YET: ROUTES has no \`firstRun\` entry, so "nothing links back to the ` +
          `onboarding surface" is true only because the surface does not exist. It is created by ` +
          `${OWNER_ROUTES}. This is a Wave 0 red for the RIGHT reason.`,
      );
    }

    expect(unsanctionedLinks(sources)).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 2
  test("the onboarding surface renders no list of past findings", () => {
    // CONTROLS, both legs.
    expect(findingsListIn([PLANTED_FINDINGS_LIST])).not.toEqual([]);
    expect(findingsListIn([CLEAN_FINDING_SLOT])).toEqual([]);

    // The receiver-scoped `.map(` must not fire on the maps the surface really
    // does render, or the guard would forbid the sequence itself.
    expect(
      findingsListIn([
        fixture("Legit", `{steps.map((step) => <StepRow key={step.id} {...step} />)}`),
      ]),
    ).toEqual([]);

    // THE TYPE-LEVEL HALF, on the mirror. It pins this repository's declared
    // reading of AD-18; it cannot pin an implementation nobody has written.
    expect(FINDING_FIELD_IS_NOT_A_LIST).toBe(true);

    // THE STRUCTURAL HALF, on the real declaration. B5 made structural: a
    // renderer that receives ONE OBJECT cannot be mapped into a list, so the
    // most likely way deviation 1 dies becomes a type error at the route, in a
    // file whose reviewer is looking at the deviation.
    const types: ScannedFile = {
      file: "packages/shared/src/onboarding/types.ts",
      source: readSourceUnderConstruction({
        repoRelativePath: "packages/shared/src/onboarding/types.ts",
        ownedBy: OWNER_TYPES,
      }),
    };

    expect(blankComments(types.source)).toMatch(/finding\s*:\s*OnboardingFinding\s*\|\s*null/);
    expect(offenders([types], FINDINGS_ARRAY)).toEqual([]);

    // AND THE RENDER HALF, over the whole surface.
    expect(findingsListIn(readAll(FIRST_RUN_TREE))).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 3
  // Covers First-Run Checklist row 1.
  test("the landing CTA renders only for a user who has not dismissed", () => {
    // CONTROLS.
    expect(ctaIsGated(PLANTED_UNGATED_CTA.source)).toBe(false);
    expect(ctaIsGated(CLEAN_GATED_CTA.source)).toBe(true);
    // ...and a gate that lives only in a COMMENT is not a gate.
    expect(
      ctaIsGated(`// renders only when !dismissed\nreturn <Link href={ROUTES.firstRun} />;`),
    ).toBe(false);

    const landing = readFirstRun(LANDING_PAGE);
    const code = blankComments(landing.source);

    // FR-O2's first half: the plain-text next-step becomes a REAL control.
    // "Nothing unbuilt is clickable" cuts both ways — once it is built, a
    // sentence claiming it is coming is its own dishonesty.
    //
    // Thrown rather than asserted, because `expect(wholeFile).toContain(…)`
    // prints the whole file on failure and the one thing that matters is which
    // contract is missing and who owes it.
    if (!code.includes("ROUTES.firstRun")) {
      throw new Error(
        `NOT IMPLEMENTED YET: apps/web/app/page.tsx renders no CTA into the first-run surface. ` +
          `FR-O2 turns \`:64-75\`'s plain-text "Next: connect your site…" into a real ` +
          `<Button component={Link} href={ROUTES.firstRun}>. It is created by ${LANDING_PAGE.ownedBy}. ` +
          `This is a Wave 0 red for the RIGHT reason: the CTA is the surface's only entrance and it ` +
          `is not built.`,
      );
    }

    // FR-O2's second half, and the operational meaning of "never linkable back
    // to": after dismissal `/` renders no CTA at all. Without the gate the
    // surface is permanently reachable from the app's front door, and
    // deviation 1 is broken by the one page every user lands on.
    expect(ctaIsGated(landing.source)).toBe(true);
  });

  // -------------------------------------------------------------- §9 row 4
  test("the binding honesty comment on page.tsx is updated, not deleted", () => {
    // CONTROLS.
    expect(missingHonestyClaims(PLANTED_DELETED_COMMENT.source)).toHaveLength(
      HONESTY_CLAIMS.length,
    );
    expect(missingHonestyClaims(CLEAN_UPDATED_COMMENT.source)).toEqual([]);
    // The claims are read from COMMENTS only — a component that happens to
    // render the word "stub" has not documented anything.
    expect(missingHonestyClaims(`<Text>stub CTA honesty rule</Text>`)).toHaveLength(
      HONESTY_CLAIMS.length,
    );

    const landing = readFirstRun(LANDING_PAGE);

    // FR-O2 and AD-17 both say UPDATED, NOT DELETED, and the distinction is the
    // point: the comment is the only place in the tree where "nothing unbuilt
    // is clickable" is written down at the exact line somebody would break it.
    // Deleting it once the CTA ships loses the rule at the moment it starts
    // governing two stubs instead of one sentence.
    expect(missingHonestyClaims(landing.source)).toEqual([]);
  });
});
