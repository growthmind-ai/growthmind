// Wave 0 is TESTS ONLY (AD-22). Every module the onboarding suites describe is
// created by a LATER wave — `packages/shared/src/onboarding/**` lands in ADD
// Wave 1. So on the Wave 0 tree these suites describe code that does not exist
// yet, and they have to do it without breaking two rules at once:
//
//   1. A SUITE THAT DOES NOT TYPECHECK IS BROKEN, NOT RED. The ADD says this
//      outright (§9 standing rule 2: "`bun test` passing is not a green build
//      … Wave 0 is not done until `bun run typecheck` and `bun run lint` also
//      pass on the failing-test tree"). `packages/shared/tsconfig.json` puts
//      `__tests__/**/*.ts` inside the typecheck target, so a STATIC
//      `import { reduceStage } from "../../src/onboarding/stage"` is TS2307
//      on this tree and takes the whole gate down.
//   2. A WAVE 0 RED MUST NAME AN ABSENT BEHAVIOUR, not an absent symbol. A
//      bare "Cannot find module" reads as a broken checkout, and a reviewer
//      cannot tell it apart from a typo in the path.
//
// This helper resolves the module at RUNTIME, through a specifier TypeScript
// does not statically resolve (the argument is a `string`, not a literal), and
// converts a resolution failure into a NAMED diagnostic that states the absent
// behaviour and the task that owns it. The type surface each suite asserts
// against is declared IN THAT SUITE, copied from the ADD's own contract block —
// so the arity and shape claims are pinned by the ADD rather than inferred from
// an implementation that has not been written.
//
// WHAT THIS BUYS ON THE DAY THE MODULE LANDS: nothing here needs editing. The
// import resolves, `assertExport` hands back the real function, and every row
// runs against real behaviour. A Wave 0 test that had to be rewritten to go
// green would not have been describing the contract in the first place.
//
// FOR WAVES 0c-0g, WHICH HIT THIS SAME WALL: use this helper rather than
// inventing a second one. `steps.ts`, `messages.ts`, `privacy-receipt.ts` and
// `slack-test.ts` are all absent on this tree for exactly the same reason, and
// four private copies of this shim is the D11 wire this file exists to avoid.

/**
 * Resolve one export of a module a later wave creates.
 *
 * @param spec.modulePath Relative to THIS FILE — a dynamic `import()` resolves
 *   against the module performing it, not the caller. Every onboarding suite
 *   sits in this same directory, so `"../../src/onboarding/<name>"` is correct
 *   from a test file and from here alike.
 * @param spec.exportName The named export to pull off the module.
 * @param spec.ownedBy The task that creates it, e.g. `"ADD Wave 1, task 1c.1"`.
 *   This lands in the failure message so a red names its own owner.
 */
export async function loadUnderConstruction<T>(spec: {
  readonly modulePath: string;
  readonly exportName: string;
  readonly ownedBy: string;
}): Promise<T> {
  let namespace: Record<string, unknown>;

  try {
    namespace = (await import(spec.modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.exportName} — ${spec.modulePath} does not exist on this tree. ` +
        `It is created by ${spec.ownedBy}. This is a Wave 0 red for the RIGHT reason: the ` +
        `behaviour is absent, and the assertion below it is the contract that wave must satisfy.`,
    );
  }

  const value = namespace[spec.exportName];

  if (typeof value !== "function") {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.modulePath} exists but exports no callable \`${spec.exportName}\`. ` +
        `${spec.ownedBy} owns that export. Found: ${typeof value}.`,
    );
  }

  return value as T;
}

// ---------------------------------------------------------------------------
// WAVE 0c ADDITIONS — the same resolution, for the exports that are not
// functions. ADDITIVE ONLY: nothing above this line changed.
//
// `loadUnderConstruction` insists the export is callable, which is right for
// `reduceStage` / `renderStageView` / `toFindingView` and wrong for the four
// things Wave 0c has to reach: `STEP_DESCRIPTORS` (a frozen array),
// `stepStateSchema` (a zod object), `ONBOARDING_PROPER_NOUNS` (a tuple), and
// the whole `onboarding/messages` namespace (the `Object.entries` completeness
// walk AD-4 inherits from `session-source/messages.test.ts` needs the module,
// not one export off it).
//
// Two new helpers rather than a fourth private copy of the try/catch — the D11
// duplication the header at the top of this file exists to prevent.
// ---------------------------------------------------------------------------

/**
 * Resolve the whole namespace of a module a later wave creates.
 *
 * The completeness walk in `messages.test.ts` is the reason this exists: its
 * whole point is that it derives the expected set from the module's ACTUAL
 * exports rather than from a hand-maintained second list, so it cannot be
 * written against a fixed set of named imports.
 *
 * @param spec.modulePath Relative to THIS FILE, exactly as above.
 * @param spec.ownedBy The task that creates it. It lands in the failure
 *   message so a red names its own owner.
 */
export async function loadModuleUnderConstruction(spec: {
  readonly modulePath: string;
  readonly ownedBy: string;
}): Promise<Record<string, unknown>> {
  try {
    return (await import(spec.modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.modulePath} does not exist on this tree. ` +
        `It is created by ${spec.ownedBy}. This is a Wave 0 red for the RIGHT reason: the ` +
        `behaviour is absent, and the assertions below it are the contract that wave must satisfy.`,
    );
  }
}

/**
 * Resolve one NON-CALLABLE export of a module a later wave creates.
 *
 * The presence check is `!== undefined` rather than a type test, because the
 * things Wave 0c reaches for are an array, a zod object and a tuple — three
 * different `typeof` answers with one shared failure mode (absent).
 */
export async function loadValueUnderConstruction<T>(spec: {
  readonly modulePath: string;
  readonly exportName: string;
  readonly ownedBy: string;
}): Promise<T> {
  const namespace = await loadModuleUnderConstruction(spec);
  const value = namespace[spec.exportName];

  if (value === undefined) {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.modulePath} exists but exports no \`${spec.exportName}\`. ` +
        `${spec.ownedBy} owns that export.`,
    );
  }

  return value as T;
}

// ---------------------------------------------------------------------------
// WAVE 0d ADDITIONS — the same two ideas, for suites that live OUTSIDE
// `packages/shared/__tests__/onboarding/`. ADDITIVE ONLY: nothing above this
// line changed, and the three loaders above are untouched.
//
// TWO PROBLEMS WAVE 0d HIT THAT WAVES 0b/0c DID NOT.
//
//   1. `modulePath` IS RESOLVED RELATIVE TO **THIS FILE**, not to the suite
//      that calls the loader — a dynamic `import()` resolves against the
//      module performing it. Every 0b/0c suite is this file's own directory
//      neighbour, so the distinction never mattered. Wave 0d's suites live in
//      `packages/db/__tests__/{tenancy,repositories,services}/`, which happen
//      to sit at the SAME depth — so `"../../../db/src/…"` resolves correctly
//      from here AND reads correctly from there, BY COINCIDENCE. That
//      coincidence is load-bearing and invisible, and the day it breaks (a
//      worker suite at `worker/__tests__/`, a route suite at
//      `apps/web/__tests__/api/first-run/`) it does not break loudly: it
//      produces a MISLEADING RED — "the module does not exist" for a module
//      that does. That is precisely the failure this file was written to
//      abolish, one level up.
//
//   2. NOT EVERY WAVE 0 RED IS A CALL. Several §9 rows are SOURCE SCANS over a
//      file a later wave writes (AD-6's "names organization_id on both sides
//      of every join", AD-20's "nothing re-implements resolveCredentialKey").
//      `readFileSync` on an absent path throws `ENOENT` — a bare errno, which
//      reads as a broken checkout for exactly the reason a bare TS2307 does.
//
// FOR WAVES 0e-0g: use `underConstructionSpecifier` for every `modulePath` and
// `readSourceUnderConstruction` for every scan. Neither depends on where your
// suite sits, and a fifth private copy of either is the D11 duplication the
// header at the top of this file exists to prevent.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The repository root, derived from THIS FILE's own location — the one place
 * the depth is written down.
 *
 * `packages/shared/__tests__/onboarding/module-under-construction.ts` is four
 * directories below the root, hence four `..`. If this file ever moves, this
 * constant is the single line that has to move with it, and every caller of
 * the two functions below keeps working unchanged.
 */
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * Turns a REPO-ROOT-RELATIVE module path into a specifier the three loaders
 * above can resolve from anywhere.
 *
 * The result is an absolute `file://` URL, so it carries no dependence on
 * either this file's location or the calling suite's — which is the whole
 * point. Extensionless paths resolve exactly as a relative specifier would.
 *
 * @param repoRelativePath e.g. `"packages/db/src/tenancy/ensure-project"`.
 *   Written the way a reader would cite it in the ADD, with no `../` arithmetic
 *   to get wrong in either direction.
 */
export function underConstructionSpecifier(repoRelativePath: string): string {
  return pathToFileURL(path.join(REPO_ROOT, repoRelativePath)).href;
}

/**
 * Reads the SOURCE of a file a later wave creates, for the §9 rows that are
 * structural scans rather than behavioural calls.
 *
 * An absent file becomes the same NAMED diagnostic the loaders produce, so a
 * scan row's red states the absent behaviour and names its owner instead of
 * surfacing an `ENOENT` a reviewer cannot tell from a typo in the path.
 *
 * @param spec.repoRelativePath Repo-root-relative, WITH its extension — this
 *   reads a file rather than resolving a module, so nothing infers `.ts`.
 * @param spec.ownedBy The task that creates it. It lands in the failure
 *   message so a red names its own owner.
 */
export function readSourceUnderConstruction(spec: {
  readonly repoRelativePath: string;
  readonly ownedBy: string;
}): string {
  try {
    return readFileSync(path.join(REPO_ROOT, spec.repoRelativePath), "utf8");
  } catch {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.repoRelativePath} does not exist on this tree, so the ` +
        `structural scan below has nothing to read. It is created by ${spec.ownedBy}. This is a ` +
        `Wave 0 red for the RIGHT reason: the file that must satisfy the invariant is absent.`,
    );
  }
}

// ---------------------------------------------------------------------------
// WAVE 0e ADDITIONS — the third shape of absence. ADDITIVE ONLY: nothing above
// this line changed, and the five helpers above are untouched.
//
// THE PROBLEM WAVES 0b-0d NEVER HIT. Every module those waves described was
// ABSENT ENTIRELY, so `loadUnderConstruction` had a resolution failure to
// convert into a named diagnostic. Wave 0e describes four modules that are
// GREEN AND SHIPPED TODAY and whose CONTRACT changes:
//
//   - `analysis-tick.ts` exists; `runAnalysisLane` is not exported from it yet
//   - `analysis-lane-source.ts` exists; its port has no `laneForProject` yet
//   - `poll-plan.ts` exists; it has no `isOnboardingPlan` yet
//   - `delivery-tick.ts` exists; its deps carry `poster`, not `posterFor`
//
// For these, the module resolves, the file reads, and the loaders above are
// perfectly happy. The absence surfaces one layer in — as a `TypeError:
// undefined is not a function` from inside production code, or as a bare
// `expect(0).toBe(1)`. BOTH READ AS A BROKEN TEST RATHER THAN AN ABSENT
// CONTRACT, which is the exact failure mode the header at the top of this file
// exists to abolish, one level further in.
//
// So: assert the contract's PRESENCE first, with the same named diagnostic, and
// only then drive it. A row that cannot reach its subject says so in the words
// of the subject rather than in the words of whatever crashed first.
// ---------------------------------------------------------------------------

/**
 * Assert that a contract a later wave adds to an ALREADY-SHIPPED module is
 * present, failing with the same named diagnostic the loaders above produce.
 *
 * Use it as the FIRST statement of any row whose subject is a new field, a new
 * method on an existing port, or a new export on an existing module — before
 * the call that would otherwise fail with a bare runtime error.
 *
 * @param present The presence check itself, evaluated by the caller — e.g.
 *   `typeof source.laneForProject === "function"` or `"posterFor" in deps`.
 * @param spec.contract What is missing, in the contract's own words.
 * @param spec.ownedBy The wave/task that adds it. It lands in the failure
 *   message so a red names its own owner.
 */
export function assertUnderConstruction(
  present: boolean,
  spec: { readonly contract: string; readonly ownedBy: string },
): asserts present {
  if (!present) {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.contract}. The module it belongs to already exists on this ` +
        `tree — it is the CONTRACT that is absent, so this red is not a broken import and not a ` +
        `broken fixture. It is created by ${spec.ownedBy}. The assertions below are what that ` +
        `wave must satisfy.`,
    );
  }
}
