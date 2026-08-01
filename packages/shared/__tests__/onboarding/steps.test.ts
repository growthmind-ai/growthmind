// THE STEP SEQUENCE — AD-19, FR-O3, FR-O15, FR-O23. ADD §9, 9 rows, PLUS the
// 5 ORPHAN CHECKLIST ROWS the taskgen pre-check (F1) found routed here with no
// §9 entry to sit on. 14 tests.
//
// ###########################################################################
// # WHAT AD-19 IS ACTUALLY BUYING, AND WHY IT IS A TYPE AND NOT A RULE.
// #
// # Two of the five steps ship as stubs. The failure everybody is trying to
// # avoid is a stub that looks live — a disabled connect field, a greyed
// # button, a "coming soon" pill with a tooltip explaining why it does not
// # work. Every one of those reads to a first-time founder as "this product
// # is broken", which is worse than an honest empty row.
// #
// # The rule "render nothing that could be mistaken for a live control" is
// # not enforceable by review, because the edit that breaks it always looks
// # helpful. So AD-19 moves it into the type: the `coming-next` arm carries
// # NO `fields`, NO `actions` and NO `confirmations`. There is no property a
// # control could be built from, so a later edit that wants one has to WIDEN
// # THE UNION FIRST — a visible, reviewable act instead of a quiet one.
// #
// # `the coming-next descriptor arm has no fields, no actions and no
// # confirmations key` is the structural half of "renders no clickable
// # control". The rendering half is a source scan in
// # `apps/web/__tests__/first-run/stub-steps.test.ts`, owned by a later wave.
// ###########################################################################
//
// THE FIVE ORPHANS (UX rows 5, 7, 8, 12, 25). Each is named in the ADD's own
// 32-row checklist table and routed to THIS FILE, and each is absent from the
// ADD's §9 enumeration. They are carried, not dropped. Every assertion is
// taken from the UX row's Expected-UI column, cited inline, because that
// column is the only place the contract is stated in full.
//
// A NOTE ON THE NORMATIVE COPY BELOW. The UX First-Run Checklist's header is
// explicit: "Copy in bold is normative — ship it verbatim or escalate to me."
// So labels are asserted by EQUALITY here, not containment. Where the spec
// gives a sentence in bold in one place and paraphrases it elsewhere, the
// bold Checklist cell wins — it is the cell `integration-tester` replays.

import { describe, expect, test } from "bun:test";

import type {
  DeriveStepStates,
  StepDescriptor,
  StepId,
  StepSequenceFacts,
  StepState,
  StepView,
} from "./contract-shapes";
import { loadUnderConstruction, loadValueUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 (task 1c.x) creates `packages/shared/src/onboarding/steps.ts`.
 *  Until then every row below is red on an ABSENT BEHAVIOUR, named as such —
 *  see `module-under-construction.ts`. */
const OWNER = "ADD Wave 1, the onboarding/steps.ts task";

/** Only `.options` is read, so the zod type is not imported — this suite has
 *  no business depending on zod's own surface to check an enum's arity. */
type EnumSchemaShape = { readonly options: readonly string[] };

const loadStepStateSchema = (): Promise<EnumSchemaShape> =>
  loadValueUnderConstruction<EnumSchemaShape>({
    modulePath: "../../src/onboarding/steps",
    exportName: "stepStateSchema",
    ownedBy: OWNER,
  });

const loadStepDescriptors = (): Promise<readonly StepDescriptor[]> =>
  loadValueUnderConstruction<readonly StepDescriptor[]>({
    modulePath: "../../src/onboarding/steps",
    exportName: "STEP_DESCRIPTORS",
    ownedBy: OWNER,
  });

const loadDeriveStepStates = (): Promise<DeriveStepStates> =>
  loadUnderConstruction<DeriveStepStates>({
    modulePath: "../../src/onboarding/steps",
    exportName: "deriveStepStates",
    ownedBy: OWNER,
  });

// --- helpers ---------------------------------------------------------------

const descriptorFor = (descriptors: readonly StepDescriptor[], id: StepId): StepDescriptor => {
  const found = descriptors.find((descriptor) => descriptor.id === id);
  if (found === undefined) throw new Error(`no descriptor for step id "${id}"`);
  return found;
};

const viewFor = (views: readonly StepView[], id: StepId): StepView => {
  const found = views.find((view) => view.id === id);
  if (found === undefined) throw new Error(`no view for step id "${id}"`);
  return found;
};

const stateOf = (views: readonly StepView[], id: StepId): StepState => viewFor(views, id).state;

/** Everything connected and nothing armed — the state the surface reaches at
 *  the end of phase A on the happy path (UX Flow A). */
const CONNECTED: StepSequenceFacts = {
  connectionStatus: "connected_receiving",
  slackConnected: true,
  slackSkipped: false,
  slackTestPostFailed: false,
  armedAt: null,
  reopenedReadOnly: false,
};

const FRESH: StepSequenceFacts = {
  connectionStatus: null,
  slackConnected: false,
  slackSkipped: false,
  slackTestPostFailed: false,
  armedAt: null,
  reopenedReadOnly: false,
};

/** The two stubs, by id. R3 (step 1) and R5 (step 4). */
const STUB_IDS: readonly StepId[] = ["repo", "agent"];

describe("the step sequence — AD-19, FR-O3, FR-O15, FR-O23", () => {
  // ---------------------------------------------------------------- §9 row 1
  test("the step state union has exactly five members including coming-next", async () => {
    const stepStateSchema = await loadStepStateSchema();

    // FR-O23: `coming-next` is a FIRST-CLASS member alongside the four a
    // conventional wizard would have. That is the whole point — filling a stub
    // in a later outcome must not widen this union, because a union that
    // widens is a union every consumer's exhaustive switch stops covering.
    expect([...stepStateSchema.options].toSorted()).toEqual(
      ["active", "coming-next", "done", "pending", "skipped"].toSorted(),
    );
    expect(stepStateSchema.options).toHaveLength(5);
  });

  // ---------------------------------------------------------------- §9 row 2
  test("each step occupies its own ordinal with a stable identity", async () => {
    const descriptors = await loadStepDescriptors();

    expect(descriptors).toHaveLength(5);

    // Ordinals 1-5, in order, no gaps. A gap is a renumber waiting to happen,
    // and a renumber is what the stub contract exists to make impossible.
    expect(descriptors.map((descriptor) => descriptor.ordinal)).toEqual([1, 2, 3, 4, 5]);

    // The five stable literals, in sequence order. These ids outlive the
    // stubs: O-013 fills `agent` and the fix-spec work fills `repo`, and
    // neither may mint a new identity for a row that was already on screen.
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      "repo",
      "analytics",
      "slack",
      "agent",
      "moment",
    ]);
  });

  // ---------------------------------------------------------------- §9 row 3
  test("the coming-next descriptor arm has no fields, no actions and no confirmations key", async () => {
    const descriptors = await loadStepDescriptors();

    for (const id of STUB_IDS) {
      const stub = descriptorFor(descriptors, id);
      expect(stub.kind).toBe("coming-next");

      // KEY ENUMERATION, not a truthiness check. `fields: []` would satisfy
      // "renders no control" today and would be a place to put one tomorrow;
      // an ABSENT key is not somewhere anything can be put without changing
      // the type first.
      expect(Object.keys(stub).toSorted()).toEqual(
        ["filler", "id", "kind", "ordinal", "title", "whatItWillDo"].toSorted(),
      );

      const keys = Object.keys(stub);
      expect(keys).not.toContain("fields");
      expect(keys).not.toContain("actions");
      expect(keys).not.toContain("confirmations");
      expect(keys).not.toContain("skippable");
    }
  });

  // ---------------------------------------------------------------- §9 row 4
  test("filling a stub changes one descriptor's kind and nothing else", async () => {
    const descriptors = await loadStepDescriptors();
    const repo = descriptorFor(descriptors, "repo");

    // The fill, as the fix-spec outcome will perform it: the SAME id at the
    // SAME ordinal, with a work body. This is the slot fill AD-19 was chosen
    // to buy — if it forced a renumber or a re-layout, the seam is wrong.
    const filled: readonly StepDescriptor[] = descriptors.map((descriptor) =>
      descriptor.id === "repo"
        ? {
            kind: "work",
            id: repo.id,
            ordinal: repo.ordinal,
            title: repo.title,
            helper: "",
            fields: [],
            actions: [],
            confirmations: [],
            skippable: false,
          }
        : descriptor,
    );

    expect(filled.map((descriptor) => descriptor.ordinal)).toEqual(
      descriptors.map((descriptor) => descriptor.ordinal),
    );
    expect(filled.map((descriptor) => descriptor.id)).toEqual(
      descriptors.map((descriptor) => descriptor.id),
    );

    // Exactly one descriptor's kind moved.
    const kindsBefore = descriptors.map((descriptor) => descriptor.kind);
    const kindsAfter = filled.map((descriptor) => descriptor.kind);
    const moved = kindsBefore.filter((kind, index) => kind !== kindsAfter[index]);
    expect(moved).toHaveLength(1);
  });

  // ---------------------------------------------------------------- §9 row 5
  test("each stub names the outcome that will fill it", async () => {
    const descriptors = await loadStepDescriptors();

    for (const id of STUB_IDS) {
      const stub = descriptorFor(descriptors, id);
      if (stub.kind !== "coming-next") throw new Error(`${id} is not a stub`);

      // "Not built yet" on its own is an absence. "Not built yet, and here is
      // what brings it" is a plan, and it is the difference between a founder
      // reading the row as honest and reading it as abandoned (UX row 4).
      expect(stub.filler.trim().length).toBeGreaterThan(0);
      expect(stub.whatItWillDo.trim().length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------- §9 row 6
  test("neither stub advances nor blocks overall completion", async () => {
    const deriveStepStates = await loadDeriveStepStates();
    const views = deriveStepStates(CONNECTED);

    // Both stubs sit at `coming-next` — not `pending`, which would read as
    // "your turn", and not `done`, which would be a fake success (R3/R5).
    for (const id of STUB_IDS) {
      expect(stateOf(views, id)).toBe("coming-next");
    }

    // And the sequence is still completable THROUGH them: with both work steps
    // resolved, step 5 is reachable. A stub that gated the glue moment would
    // make the MVP's one screen unreachable until two later outcomes ship.
    expect(["active", "done"]).toContain(stateOf(views, "moment"));
  });

  // ---------------------------------------------------------------- §9 row 7
  test("skipping slack yields the skipped state, never failed and never pending", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    // FR-O14 / deviation 2. Skipping is a legitimate finished answer, so the
    // step resolves — it does not sit unfinished and it is not an error. The
    // honest degraded notice rides in the strip; the STEP is settled.
    const views = deriveStepStates({ ...CONNECTED, slackConnected: false, slackSkipped: true });

    expect(stateOf(views, "slack")).toBe("skipped");
    expect(stateOf(views, "slack")).not.toBe("pending");
    expect(stateOf(views, "slack")).not.toBe("active");

    // And the sequence still reaches the glue moment — that is the whole
    // deviation: Slack is skippable, and skipping costs the founder nothing
    // on this screen.
    expect(["active", "done"]).toContain(stateOf(views, "moment"));
  });

  // ---------------------------------------------------------------- §9 row 8
  test("a failed slack test post leaves step three active and not done", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    // UX Flow D. A test post that failed has not proved anything, so the step
    // is NOT marked done — but setup is not broken either: the step stays the
    // step the founder is standing on, with "Skip for now" still in it.
    const views = deriveStepStates({
      ...CONNECTED,
      slackConnected: false,
      slackTestPostFailed: true,
    });

    expect(stateOf(views, "slack")).toBe("active");
    expect(stateOf(views, "slack")).not.toBe("done");
    expect(stateOf(views, "slack")).not.toBe("skipped");
  });

  // ---------------------------------------------------------------- §9 row 9
  test("disconnecting analytics returns step two to pending and holds every other step's state", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const before = deriveStepStates(CONNECTED);
    const after = deriveStepStates({ ...CONNECTED, connectionStatus: "disconnected" });

    // OQ-O7 / Flow F. Step 2 goes back to its form…
    expect(stateOf(after, "analytics")).toBe("pending");

    // …and NOTHING ELSE MOVES. Nothing is thrown away because one connection
    // was re-keyed: Slack stays connected, the stubs stay stubs, and a finding
    // already on the stage stays on the stage. Asserted as a diff over every
    // other step rather than one spot check, so a future reset cannot hide in
    // the step nobody thought to name.
    for (const id of ["repo", "slack", "agent", "moment"] as const) {
      expect(stateOf(after, id)).toBe(stateOf(before, id));
    }
  });
});

// ===========================================================================
// THE FIVE ORPHAN ROWS. Named in the ADD's checklist table, routed to this
// file, absent from its §9 enumeration. Assertions taken from the UX spec's
// Expected-UI column, which is where the contract is stated in full.
// ===========================================================================

describe("orphan checklist rows — assertions taken from the UX Expected-UI column", () => {
  // ---------------------------------------------------------------- UX row 5
  test("step two declares exactly two visible fields and a folded region disclosure", async () => {
    const descriptors = await loadStepDescriptors();
    const analytics = descriptorFor(descriptors, "analytics");
    if (analytics.kind !== "work") throw new Error("step 2 must be a work step");

    // "Exactly two visible fields — the region is prefilled and folded, and the
    // Growthmind project id is resolved server-side and never asked for."
    const visible = analytics.fields.filter((field) => !field.folded);
    const folded = analytics.fields.filter((field) => field.folded);

    expect(visible).toHaveLength(2);
    expect(folded).toHaveLength(1);
    expect(analytics.fields).toHaveLength(3);

    // The two visible labels, verbatim from the bold cell.
    expect(visible.map((field) => field.label)).toEqual([
      "Project number",
      "Your personal API key",
    ]);

    // The key is masked; the project number is not a secret and pretending it
    // is would make it un-checkable by the person pasting it.
    const [projectNumber, personalKey] = visible;
    expect(projectNumber?.secret).toBe(false);
    expect(personalKey?.secret).toBe(true);
    expect(projectNumber?.placeholder).toBe("12345");

    // The region: folded, and PREFILLED with the shipped default, so the
    // common case needs no typing at all.
    expect(folded[0]?.prefill).toBe("https://us.i.posthog.com");
    expect(folded[0]?.secret).toBe(false);

    // A VISIBLE field is never prefilled. A field the product can fill in for
    // you is a field it should not have asked for.
    for (const field of visible) {
      expect(field.prefill).toBeNull();
    }

    // AND THE GROWTHMIND PROJECT ID IS NEVER ASKED FOR. FR-O1 provisions it
    // and AD-16 keeps it off every route's input schema; a field for it here
    // would put the tenancy id back in the customer's hands through the front
    // door. Asserted over labels, ids and helper text so it cannot re-enter as
    // an "optional" extra.
    const everyDeclaredString = analytics.fields.flatMap((field) => [
      field.id,
      field.label,
      field.helper ?? "",
    ]);
    for (const value of everyDeclaredString) {
      expect(value).not.toMatch(/growthmind/i);
      expect(value).not.toMatch(/workspace id|organisation id|organization id/i);
    }
  });

  // ---------------------------------------------------------------- UX row 7
  test("an unreachable refusal marks the region field as the offending one", async () => {
    const descriptors = await loadStepDescriptors();
    const analytics = descriptorFor(descriptors, "analytics");
    if (analytics.kind !== "work") throw new Error("step 2 must be a work step");

    // "The region disclosure AUTO-EXPANDS, because that is the field the
    // sentence is about." The sentence is
    // `CONNECT_REFUSAL_MESSAGES.unreachable` — "Check the region address" —
    // and a refusal that names a field the founder cannot see is a dead end.
    const owningUnreachable = analytics.fields.filter((field) =>
      field.refusalCodes.includes("unreachable"),
    );

    expect(owningUnreachable).toHaveLength(1);
    expect(owningUnreachable[0]?.folded).toBe(true);
    expect(owningUnreachable[0]?.prefill).toBe("https://us.i.posthog.com");

    // And the mapping is not a one-entry special case: UX row 6 puts focus on
    // the KEY field for a bad key, which is the same wire carrying a different
    // code. One mechanism, two rows.
    const owningInvalidCredentials = analytics.fields.filter((field) =>
      field.refusalCodes.includes("invalid_credentials"),
    );
    expect(owningInvalidCredentials).toHaveLength(1);
    expect(owningInvalidCredentials[0]?.secret).toBe(true);
    expect(owningInvalidCredentials[0]?.id).not.toBe(owningUnreachable[0]?.id);
  });

  // ---------------------------------------------------------------- UX row 8
  test("a successful connect marks step two done, keeps it open, and opens step three", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const before = deriveStepStates(FRESH);
    // On arrival step 2 is ALREADY OPEN — "the user never has to click a row to
    // find the work" (UX row 2).
    expect(stateOf(before, "analytics")).toBe("active");
    expect(viewFor(before, "analytics").open).toBe(true);

    const after = deriveStepStates({ ...FRESH, connectionStatus: "connected_receiving" });

    // "Step 2 flips to done ✓ AND STAYS OPEN" — done-and-collapsed would throw
    // away both confirmations (the counter and the receipt) at the exact moment
    // they are the proof the connection worked.
    expect(stateOf(after, "analytics")).toBe("done");
    expect(viewFor(after, "analytics").open).toBe(true);

    // "…and step 3 opens beneath WITHOUT A CLICK." One of the two "Next"
    // presses this design deleted.
    expect(stateOf(after, "slack")).toBe("active");
    expect(viewFor(after, "slack").open).toBe(true);
  });

  // --------------------------------------------------------------- UX row 12
  test("step three declares two fields and two actions, one of them skip", async () => {
    const descriptors = await loadStepDescriptors();
    const slack = descriptorFor(descriptors, "slack");
    if (slack.kind !== "work") throw new Error("step 3 must be a work step");

    expect(slack.fields).toHaveLength(2);
    expect(slack.fields.map((field) => field.label)).toEqual(["Bot token", "Channel ID"]);
    expect(slack.fields[0]?.secret).toBe(true);
    expect(slack.fields[0]?.placeholder).toBe("xoxb-…");
    expect(slack.fields[1]?.secret).toBe(false);
    expect(slack.fields[1]?.placeholder).toBe("C01AB2CD3EF");

    // Two actions, ranked. The skip is SECONDARY and it is always there —
    // deviation 2 is that Slack is skippable, and a skip a founder cannot find
    // is not a skip.
    expect(slack.actions).toHaveLength(2);
    expect(slack.actions.map((action) => action.label)).toEqual([
      "Send a test message",
      "Skip for now",
    ]);
    expect(slack.actions.map((action) => action.rank)).toEqual(["primary", "secondary"]);
    expect(slack.skippable).toBe(true);

    // Step 2 is NOT skippable — it is the one connection the product cannot
    // work without, and the contrast is the reason `skippable` is data.
    const analytics = descriptorFor(descriptors, "analytics");
    if (analytics.kind !== "work") throw new Error("step 2 must be a work step");
    expect(analytics.skippable).toBe(false);
  });

  // --------------------------------------------------------------- UX row 25
  test("re-opening the sequence renders every step read-only and re-activates none", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const armed: StepSequenceFacts = {
      ...CONNECTED,
      armedAt: new Date("2026-08-01T10:00:00.000Z"),
    };
    const live = deriveStepStates(armed);
    const reopened = deriveStepStates({ ...armed, reopenedReadOnly: true });

    // "Every step at its RESOLVED state" — the states themselves do not change,
    // because the facts did not. Read-only is a rendering decision, never a
    // second opinion about what happened.
    for (const view of reopened) {
      expect(view.state).toBe(stateOf(live, view.id));
    }

    // "NO step re-activates, NO form re-opens." The sequence is a record of
    // what happened; a control inside it would be a second, competing place to
    // change setup the founder has already finished, sitting above a stage
    // that is mid-wait.
    for (const view of reopened) {
      expect(view.interactive).toBe(false);
    }

    // AND READ-ONLY WINS OVER A STEP THAT WOULD OTHERWISE HAVE A FORM. The
    // reachable case (Flow F): a teammate disconnects while this user is
    // watching, so step 2 falls back to `pending` — the state whose whole body
    // IS a form — while the stage is still armed. The state is honest and the
    // form still does not come back.
    const disconnectedWhileWatching = deriveStepStates({
      ...armed,
      connectionStatus: "disconnected",
      reopenedReadOnly: true,
    });
    expect(stateOf(disconnectedWhileWatching, "analytics")).toBe("pending");
    expect(viewFor(disconnectedWhileWatching, "analytics").interactive).toBe(false);

    // Neither WORK step re-activates. `moment` is deliberately not in this
    // list: it is the stage, and the stage is the live thing the founder came
    // back to look at — re-opening the sequence above it does not retire it.
    for (const id of ["analytics", "slack"] as const) {
      expect(stateOf(disconnectedWhileWatching, id)).not.toBe("active");
      expect(stateOf(reopened, id)).not.toBe("active");
    }
  });
});
