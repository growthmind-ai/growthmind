// The refusal-to-sentence mapping (AD-16a). ADD §9, 6 rows.
//
// ###########################################################################
// # AN ORPHAN FILE, PICKED UP DELIBERATELY — SAY SO RATHER THAN LEAVE IT.
// #
// # `apps/web/__tests__/api/first-run/refusal-mapping.test.ts` is named by ADD
// # §9 (lines 1075-1082) and has NO TASK IN tasks.xml. It is one of the +13
// # rows the ADD gained in its 2026-08-01 amendment, after taskgen had already
// # run — the header of tasks.xml records that drift as known and intended.
// # It sits in the route block, so Wave 0f took it. Wave 0g was told.
// #
// # WHAT IT PROTECTS, AND WHY A ROUTE TEST CANNOT.
// #
// # AD-16 requires every 400 to carry "a sentence from our table and never a
// # raw Zod message". The route rows assert the STATUS CODE and the ABSENCE of
// # zod's text. Neither can assert that the mapping SURVIVES the input — and
// # Wave 0a measured three shapes that break a naively-written one:
// #
// #   1. `issue.path` is `[]`. The offending names live on `issue.keys`, and
// #      `flattenError()` puts the message in `formErrors` with `fieldErrors:
// #      {}`. A helper written against `path` produces an EMPTY refusal; a
// #      test expecting the field under `fieldErrors` fails on a correct one.
// #   2. N unknown keys collapse into ONE issue with an N-element `keys`
// #      array. Never one issue per key.
// #   3. `null`, `undefined`, `[]`, `"str"` and `42` refuse as `invalid_type`,
// #      NOT `unrecognized_keys` — and that is the ORDINARY case, because it
// #      is what `request.json()` yields when a client posts nothing. A
// #      mapping that keys only off `unrecognized_keys` THROWS on the very
// #      input it exists to refuse, turning a 400 into a 500.
// #
// # Every row below pairs the MEASURED ZOD FACT (the setup, true today) with
// # an assertion on `describeBodyRefusal` (absent today). The measurement is
// # inside the row rather than in a probe of its own so that a zod bump which
// # changed it cannot quietly weaken the row that depends on it.
// ###########################################################################
//
// Lane prefix `web-fr-refusal`.
import { describe, expect, test } from "bun:test";

import {
  NON_OBJECT_BODIES,
  flattenOf,
  refusalFor,
} from "../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import { loadDescribeBodyRefusal, unrecognizedKeysOf } from "./helpers/first-run-route-contract";

/** A body carrying ONE key the schema never declared. */
const ONE_UNKNOWN = { stepId: "connect-slack", projectId: "proj_123" };
/** And one carrying TWO — the input trap 2 is about. */
const TWO_UNKNOWN = { stepId: "connect-slack", projectId: "proj_123", organizationId: "org_9" };

describe("the three measured shape traps (AD-16a, probe 0a.2)", () => {
  // ------------------------------------------------------------------ row 1
  test("an unrecognized_keys issue carries its offending names in issue.keys, never in issue.path", async () => {
    const error = refusalFor(ONE_UNKNOWN);
    const issue = error.issues[0];
    if (!issue) throw new Error("a strict schema refused with no issues at all");

    // MEASURED TRAP 1, pinned. `path` is EMPTY on this issue — so a 400-body
    // helper written against `issue.path` names nothing and tells a customer
    // nothing about what to remove.
    expect(issue.code).toBe("unrecognized_keys");
    expect(issue.path).toEqual([]);
    expect(unrecognizedKeysOf(issue)).toEqual(["projectId"]);

    // AND THE MAPPING READS THE RIGHT ONE. The sentence must name the key the
    // customer sent, which is only reachable through `keys`.
    const describeBodyRefusal = await loadDescribeBodyRefusal();
    const refusal = describeBodyRefusal(error);

    expect(refusal.status).toBe(400);
    expect(refusal.code).toBe("unrecognized_keys");
    expect(refusal.message).toContain("projectId");
  });

  // ------------------------------------------------------------------ row 2
  test("flattenError puts the refusal in formErrors with an empty fieldErrors", async () => {
    const error = refusalFor(ONE_UNKNOWN);
    const flat = flattenOf(error);

    // THE SAME TRAP FROM THE OTHER DIRECTION. A test asserting the offending
    // field appears under `fieldErrors` would fail against a CORRECT schema —
    // which is how a reviewer ends up "fixing" the schema to satisfy the test.
    expect(flat.fieldErrors).toEqual({});
    expect(flat.formErrors.length).toBe(1);

    // So the mapping does not route through `fieldErrors`: its sentence is
    // present and non-empty even though `fieldErrors` is `{}`.
    const describeBodyRefusal = await loadDescribeBodyRefusal();
    const refusal = describeBodyRefusal(error);
    expect(refusal.message.length).toBeGreaterThan(0);
    // And it is OUR sentence, not zod's — the raw message never crosses.
    expect(refusal.message).not.toBe(flat.formErrors[0]);
    expect(refusal.message).not.toContain("Unrecognized key");
  });

  // ------------------------------------------------------------------ row 3
  test("two unknown keys collapse into one issue carrying both names", async () => {
    const error = refusalFor(TWO_UNKNOWN);

    // MEASURED TRAP 2: ONE issue, a TWO-element `keys` array. A row asserting
    // one issue per bad key fails against correct zod, forever.
    expect(error.issues.length).toBe(1);
    expect([...unrecognizedKeysOf(error.issues[0]!)].toSorted()).toEqual(
      ["organizationId", "projectId"].toSorted(),
    );

    // The sentence names BOTH, so a customer removing one key does not get a
    // second identical refusal for the other.
    const describeBodyRefusal = await loadDescribeBodyRefusal();
    const refusal = describeBodyRefusal(error);
    expect(refusal.message).toContain("projectId");
    expect(refusal.message).toContain("organizationId");
  });

  // ------------------------------------------------------------------ row 4
  test("a null, undefined, array, string or number body refuses as invalid_type, not unrecognized_keys", async () => {
    const describeBodyRefusal = await loadDescribeBodyRefusal();

    for (const { label, body } of NON_OBJECT_BODIES) {
      const error = refusalFor(body);
      const issue = error.issues[0];
      if (!issue) throw new Error(`${label}: refused with no issues`);

      // MEASURED TRAP 3, pinned per shape. This is the ORDINARY case: it is
      // what `request.json()` yields when a client posts an empty body.
      expect(`${label}:${issue.code}`).toBe(`${label}:invalid_type`);

      // The mapping covers it, and says so as its OWN code — not by falling
      // through the unrecognized-keys branch and producing a sentence about
      // keys nobody sent.
      const refusal = describeBodyRefusal(error);
      expect(`${label}:${refusal.code}`).toBe(`${label}:invalid_body`);
      expect(`${label}:${refusal.status}`).toBe(`${label}:400`);
    }
  });
});

describe("the mapping's own obligations (AD-16)", () => {
  // ------------------------------------------------------------------ row 5
  test("every refusal maps to a sentence from our table, for both issue codes", async () => {
    const describeBodyRefusal = await loadDescribeBodyRefusal();

    const bothCodes = [
      refusalFor(ONE_UNKNOWN),
      refusalFor(TWO_UNKNOWN),
      ...NON_OBJECT_BODIES.map((shape) => refusalFor(shape.body)),
    ];

    for (const error of bothCodes) {
      const refusal = describeBodyRefusal(error);

      // PLAIN ENGLISH, FROM OUR TABLE. A raw Zod message never reaches a
      // customer — the same discipline `sign-up-form.tsx:14-16` already ships,
      // and the same rule `connections.service.ts` applies to vendor text.
      expect(refusal.message.length).toBeGreaterThan(0);
      for (const zodism of [
        "Invalid input",
        "expected object",
        "received undefined",
        "ZodError",
        "issues",
        "safeParse",
      ]) {
        expect(`${refusal.code}: contains "${zodism}"? ${refusal.message.includes(zodism)}`).toBe(
          `${refusal.code}: contains "${zodism}"? false`,
        );
      }

      // No error code and no HTTP status in the copy a person reads.
      expect(refusal.message).not.toMatch(/\b[45]\d\d\b/);
      expect(refusal.message).not.toMatch(/:\d+:\d+/);

      // Every refusal is a 400. Never a 500, never a 200.
      expect(refusal.status).toBe(400);
    }

    // BOTH CODES ARE ACTUALLY EXERCISED ABOVE — a mapping covering only one
    // would still be green if the loop never produced the other.
    const codes = new Set(bothCodes.map((error) => describeBodyRefusal(error).code));
    expect([...codes].toSorted()).toEqual(["invalid_body", "unrecognized_keys"]);
  });

  // ------------------------------------------------------------------ row 6
  test("the mapping throws on none of the six body shapes it exists to refuse", async () => {
    const describeBodyRefusal = await loadDescribeBodyRefusal();

    // SIX SHAPES: the unknown-key case plus the five non-object bodies. A
    // mapping that throws on any of them turns a 400 into a 500 on the very
    // input it was written for — the failure mode the three traps describe,
    // stated as one assertion a reviewer can read in isolation.
    const shapes: readonly { readonly label: string; readonly body: unknown }[] = [
      { label: "an unknown key", body: ONE_UNKNOWN },
      ...NON_OBJECT_BODIES,
    ];

    for (const { label, body } of shapes) {
      const error = refusalFor(body);
      let threw: unknown = null;
      let message = "";
      try {
        message = describeBodyRefusal(error).message;
      } catch (caught) {
        threw = caught;
      }
      expect(`${label}: threw? ${threw !== null}`).toBe(`${label}: threw? false`);
      expect(`${label}: produced a sentence? ${message.length > 0}`).toBe(
        `${label}: produced a sentence? true`,
      );
    }
  });
});
