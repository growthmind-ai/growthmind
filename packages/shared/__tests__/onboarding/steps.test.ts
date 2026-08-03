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

const OWNER = "ADD Wave 1, the onboarding/steps.ts task";

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

const STUB_IDS: readonly StepId[] = ["repo", "agent"];

describe("the step sequence — AD-19, FR-O3, FR-O15, FR-O23", () => {
  test("the step state union has exactly five members including coming-next", async () => {
    const stepStateSchema = await loadStepStateSchema();

    expect([...stepStateSchema.options].toSorted()).toEqual(
      ["active", "coming-next", "done", "pending", "skipped"].toSorted(),
    );
    expect(stepStateSchema.options).toHaveLength(5);
  });

  test("each step occupies its own ordinal with a stable identity", async () => {
    const descriptors = await loadStepDescriptors();

    expect(descriptors).toHaveLength(5);

    expect(descriptors.map((descriptor) => descriptor.ordinal)).toEqual([1, 2, 3, 4, 5]);

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      "repo",
      "analytics",
      "slack",
      "agent",
      "moment",
    ]);
  });

  test("the coming-next descriptor arm has no fields, no actions and no confirmations key", async () => {
    const descriptors = await loadStepDescriptors();

    for (const id of STUB_IDS) {
      const stub = descriptorFor(descriptors, id);
      expect(stub.kind).toBe("coming-next");

      expect(Object.keys(stub).toSorted()).toEqual(
        ["id", "kind", "ordinal", "rail", "title", "whatItWillDo"].toSorted(),
      );

      const keys = Object.keys(stub);
      expect(keys).not.toContain("fields");
      expect(keys).not.toContain("actions");
      expect(keys).not.toContain("confirmations");
      expect(keys).not.toContain("skippable");
    }
  });

  test("filling a stub changes one descriptor's kind and nothing else", async () => {
    const descriptors = await loadStepDescriptors();
    const repo = descriptorFor(descriptors, "repo");

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

    const kindsBefore = descriptors.map((descriptor) => descriptor.kind);
    const kindsAfter = filled.map((descriptor) => descriptor.kind);
    const moved = kindsBefore.filter((kind, index) => kind !== kindsAfter[index]);
    expect(moved).toHaveLength(1);
  });

  test("each stub names the outcome that will fill it and the rail that fills its chips", async () => {
    const descriptors = await loadStepDescriptors();

    for (const id of STUB_IDS) {
      const stub = descriptorFor(descriptors, id);
      if (stub.kind !== "coming-next") throw new Error(`${id} is not a stub`);

      expect(stub.rail).toBe(id === "repo" ? "code" : "coding-assistant");
      expect(stub.whatItWillDo.trim().length).toBeGreaterThan(0);
    }
  });

  test("neither stub advances nor blocks overall completion", async () => {
    const deriveStepStates = await loadDeriveStepStates();
    const views = deriveStepStates(CONNECTED);

    for (const id of STUB_IDS) {
      expect(stateOf(views, id)).toBe("coming-next");
    }

    expect(["active", "done"]).toContain(stateOf(views, "moment"));
  });

  test("skipping slack yields the skipped state, never failed and never pending", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const views = deriveStepStates({ ...CONNECTED, slackConnected: false, slackSkipped: true });

    expect(stateOf(views, "slack")).toBe("skipped");
    expect(stateOf(views, "slack")).not.toBe("pending");
    expect(stateOf(views, "slack")).not.toBe("active");

    expect(["active", "done"]).toContain(stateOf(views, "moment"));
  });

  test("a failed slack test post leaves step three active and not done", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const views = deriveStepStates({
      ...CONNECTED,
      slackConnected: false,
      slackTestPostFailed: true,
    });

    expect(stateOf(views, "slack")).toBe("active");
    expect(stateOf(views, "slack")).not.toBe("done");
    expect(stateOf(views, "slack")).not.toBe("skipped");
  });

  test("disconnecting analytics returns step two to pending and holds every other step's state", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const before = deriveStepStates(CONNECTED);
    const after = deriveStepStates({ ...CONNECTED, connectionStatus: "disconnected" });

    expect(stateOf(after, "analytics")).toBe("pending");

    for (const id of ["repo", "slack", "agent", "moment"] as const) {
      expect(stateOf(after, id)).toBe(stateOf(before, id));
    }
  });
});

describe("orphan checklist rows — assertions taken from the UX Expected-UI column", () => {
  test("step two declares exactly one visible field and one earned, folded address", async () => {
    const descriptors = await loadStepDescriptors();
    const analytics = descriptorFor(descriptors, "analytics");
    if (analytics.kind !== "work") throw new Error("step 2 must be a work step");

    // ONE visible field: the project number is discovered from the key (AD-1/AD-3) and the
    // region is probed rather than asked (AD-2), so neither is a field — both were the hunt.
    const visible = analytics.fields.filter((field) => !field.folded);
    const folded = analytics.fields.filter((field) => field.folded);

    expect(visible).toHaveLength(1);
    expect(folded).toHaveLength(1);
    expect(analytics.fields).toHaveLength(2);

    // The one visible label, verbatim, and it is masked.
    expect(visible.map((field) => field.label)).toEqual(["Your personal API key"]);
    expect(visible[0]?.secret).toBe(true);

    // The address is NOT prefilled — it shows the shipped default as a placeholder instead. A
    // prefilled value is a value the next submit SENDS, taking the single-request self-host
    // branch at the address that just refused and skipping the region walk the founder needs.
    expect(folded[0]?.prefill).toBeNull();
    expect(folded[0]?.placeholder).toBe("https://us.i.posthog.com");
    expect(folded[0]?.secret).toBe(false);
    // The disclosure sentence is audited in `messages.test.ts`: reaching it here would mean
    // widening this file's Wave 0 mirror of `FieldDescriptor` until it stopped being a mirror.

    // NO field is prefilled now. A field the product can fill in for you is a field it should
    // not have asked for.
    for (const field of analytics.fields) {
      expect(field.prefill).toBeNull();
    }

    const everyDeclaredString = analytics.fields.flatMap((field) => [
      field.id,
      field.label,
      field.helper ?? "",
      field.placeholder ?? "",
    ]);

    // THE PROJECT NUMBER CANNOT RE-ENTER AS A FIELD. This array is what the form renders and
    // what a refusal maps onto, so a re-added descriptor is the hunt coming back — it would
    // pull `project_not_found` off the card onto an input.
    for (const value of everyDeclaredString) {
      expect(value).not.toMatch(/project ?number/i);
    }

    // Nor the Growthmind project id: FR-O1 provisions it and AD-16 keeps it off every route's
    // input schema. Asserted over ids, labels and helper text so it cannot return as optional.
    for (const value of everyDeclaredString) {
      expect(value).not.toMatch(/growthmind/i);
      expect(value).not.toMatch(/workspace id|organisation id|organization id/i);
    }
  });

  test("every declared field shows an example of what to type", async () => {
    const descriptors = await loadStepDescriptors();

    const fields = descriptors.flatMap((descriptor) =>
      descriptor.kind === "work" ? descriptor.fields : [],
    );

    expect(fields.length).toBeGreaterThan(0);

    const unhinted = fields.filter((field) => (field.placeholder ?? "").trim() === "");
    expect(unhinted.map((field) => field.id)).toEqual([]);
  });

  test("an unreachable refusal marks the address field as the offending one", async () => {
    const descriptors = await loadStepDescriptors();
    const analytics = descriptorFor(descriptors, "analytics");
    if (analytics.kind !== "work") throw new Error("step 2 must be a work step");

    // The disclosure auto-expands, because it is the field `CONNECT_REFUSAL_MESSAGES.unreachable`
    // is about — and it is the same code that EARNS the disclosure, so both must name one field.
    const owningUnreachable = analytics.fields.filter((field) =>
      field.refusalCodes.includes("unreachable"),
    );

    expect(owningUnreachable).toHaveLength(1);
    expect(owningUnreachable[0]?.folded).toBe(true);
    expect(owningUnreachable[0]?.placeholder).toBe("https://us.i.posthog.com");

    const owningInvalidCredentials = analytics.fields.filter((field) =>
      field.refusalCodes.includes("invalid_credentials"),
    );
    expect(owningInvalidCredentials).toHaveLength(1);
    expect(owningInvalidCredentials[0]?.secret).toBe(true);
    expect(owningInvalidCredentials[0]?.id).not.toBe(owningUnreachable[0]?.id);

    // `project_not_found` is the subject of NO field, by design: nobody types a project number
    // now, so it renders as the card's own sentence rather than on an input nobody can fix.
    const owningProjectNotFound = analytics.fields.filter((field) =>
      field.refusalCodes.includes("project_not_found"),
    );
    expect(owningProjectNotFound).toHaveLength(0);
  });

  test("a successful connect marks step two done, keeps it open, and opens step three", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const before = deriveStepStates(FRESH);

    expect(stateOf(before, "analytics")).toBe("active");
    expect(viewFor(before, "analytics").open).toBe(true);

    const after = deriveStepStates({ ...FRESH, connectionStatus: "connected_receiving" });

    expect(stateOf(after, "analytics")).toBe("done");
    expect(viewFor(after, "analytics").open).toBe(true);

    expect(stateOf(after, "slack")).toBe("active");
    expect(viewFor(after, "slack").open).toBe(true);
  });

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

    expect(slack.actions).toHaveLength(2);
    expect(slack.actions.map((action) => action.label)).toEqual([
      "Send a test message",
      "Skip for now",
    ]);
    expect(slack.actions.map((action) => action.rank)).toEqual(["primary", "secondary"]);
    expect(slack.skippable).toBe(true);

    const analytics = descriptorFor(descriptors, "analytics");
    if (analytics.kind !== "work") throw new Error("step 2 must be a work step");
    expect(analytics.skippable).toBe(false);
  });

  test("re-opening the sequence renders every step read-only and re-activates none", async () => {
    const deriveStepStates = await loadDeriveStepStates();

    const armed: StepSequenceFacts = {
      ...CONNECTED,
      armedAt: new Date("2026-08-01T10:00:00.000Z"),
    };
    const live = deriveStepStates(armed);
    const reopened = deriveStepStates({ ...armed, reopenedReadOnly: true });

    for (const view of reopened) {
      expect(view.state).toBe(stateOf(live, view.id));
    }

    for (const view of reopened) {
      expect(view.interactive).toBe(false);
    }

    const disconnectedWhileWatching = deriveStepStates({
      ...armed,
      connectionStatus: "disconnected",
      reopenedReadOnly: true,
    });
    expect(stateOf(disconnectedWhileWatching, "analytics")).toBe("pending");
    expect(viewFor(disconnectedWhileWatching, "analytics").interactive).toBe(false);

    for (const id of ["analytics", "slack"] as const) {
      expect(stateOf(disconnectedWhileWatching, id)).not.toBe("active");
      expect(stateOf(reopened, id)).not.toBe("active");
    }
  });
});
