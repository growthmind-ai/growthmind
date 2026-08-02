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

const SURFACE_REFERENCE = /ROUTES\.firstRun|["'`]\/first-run\b/;

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

const unsanctionedLinks = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(
    files.filter((scanned) => !isExempt(scanned.file)),
    SURFACE_REFERENCE,
  );

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

const FINDINGS_MAP = /\b[\w.]*[Ff]inding[\w.]*\s*(\?\.)?\s*\.?\s*map\s*\(/;

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

type FindingFieldIsNotAList = FirstRunStatus["finding"] extends readonly unknown[] ? never : true;
const FINDING_FIELD_IS_NOT_A_LIST: FindingFieldIsNotAList = true;

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

describe("deviation 1 — the surface nothing links back to (FR-O21, AC-O26)", () => {
  test("no route or rendered anchor targets the onboarding surface after completion", () => {
    expect(unsanctionedLinks([PLANTED_NAV])).not.toEqual([]);
    expect(unsanctionedLinks([PLANTED_NAV])).toHaveLength(2);
    expect(unsanctionedLinks([CLEAN_NAV])).toEqual([]);

    const asSurfaceFile = fixtureAt(
      "apps/web/components/first-run/FirstRunClient.tsx",
      PLANTED_NAV.source,
    );
    expect(unsanctionedLinks([asSurfaceFile])).toEqual([]);

    expect(unsanctionedLinks([fixtureAt("apps/web/app/page.tsx", PLANTED_NAV.source)])).toEqual([]);

    for (const { why } of EXEMPT) expect(why.trim().length).toBeGreaterThan(0);

    const sources = webSources();
    expect(sources.length).toBeGreaterThan(10);

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

  test("the onboarding surface renders no list of past findings", () => {
    expect(findingsListIn([PLANTED_FINDINGS_LIST])).not.toEqual([]);
    expect(findingsListIn([CLEAN_FINDING_SLOT])).toEqual([]);

    expect(
      findingsListIn([
        fixture("Legit", `{steps.map((step) => <StepRow key={step.id} {...step} />)}`),
      ]),
    ).toEqual([]);

    expect(FINDING_FIELD_IS_NOT_A_LIST).toBe(true);

    const types: ScannedFile = {
      file: "packages/shared/src/onboarding/types.ts",
      source: readSourceUnderConstruction({
        repoRelativePath: "packages/shared/src/onboarding/types.ts",
        ownedBy: OWNER_TYPES,
      }),
    };

    expect(blankComments(types.source)).toMatch(/finding\s*:\s*OnboardingFinding\s*\|\s*null/);
    expect(offenders([types], FINDINGS_ARRAY)).toEqual([]);

    expect(findingsListIn(readAll(FIRST_RUN_TREE))).toEqual([]);
  });

  test("the landing CTA renders only for a user who has not dismissed", () => {
    expect(ctaIsGated(PLANTED_UNGATED_CTA.source)).toBe(false);
    expect(ctaIsGated(CLEAN_GATED_CTA.source)).toBe(true);

    expect(
      ctaIsGated(`// renders only when !dismissed\nreturn <Link href={ROUTES.firstRun} />;`),
    ).toBe(false);

    const landing = readFirstRun(LANDING_PAGE);
    const code = blankComments(landing.source);

    if (!code.includes("ROUTES.firstRun")) {
      throw new Error(
        `NOT IMPLEMENTED YET: apps/web/app/page.tsx renders no CTA into the first-run surface. ` +
          `FR-O2 turns \`:64-75\`'s plain-text "Next: connect your site…" into a real ` +
          `<Button component={Link} href={ROUTES.firstRun}>. It is created by ${LANDING_PAGE.ownedBy}. ` +
          `This is a Wave 0 red for the RIGHT reason: the CTA is the surface's only entrance and it ` +
          `is not built.`,
      );
    }

    expect(ctaIsGated(landing.source)).toBe(true);
  });

  test("the binding honesty comment on page.tsx is updated, not deleted", () => {
    expect(missingHonestyClaims(PLANTED_DELETED_COMMENT.source)).toHaveLength(
      HONESTY_CLAIMS.length,
    );
    expect(missingHonestyClaims(CLEAN_UPDATED_COMMENT.source)).toEqual([]);

    expect(missingHonestyClaims(`<Text>stub CTA honesty rule</Text>`)).toHaveLength(
      HONESTY_CLAIMS.length,
    );

    const landing = readFirstRun(LANDING_PAGE);

    expect(missingHonestyClaims(landing.source)).toEqual([]);
  });
});
