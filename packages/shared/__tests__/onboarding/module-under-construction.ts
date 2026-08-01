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
