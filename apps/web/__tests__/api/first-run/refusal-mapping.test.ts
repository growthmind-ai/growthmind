import { describe, expect, test } from "bun:test";

import {
  NON_OBJECT_BODIES,
  flattenOf,
  refusalFor,
} from "../../../../../packages/shared/__tests__/onboarding/probes/strict-zod-fixtures";
import { loadDescribeBodyRefusal, unrecognizedKeysOf } from "./helpers/first-run-route-contract";

const ONE_UNKNOWN = { stepId: "connect-slack", projectId: "proj_123" };

const TWO_UNKNOWN = { stepId: "connect-slack", projectId: "proj_123", organizationId: "org_9" };

describe("the three measured shape traps (AD-16a, probe 0a.2)", () => {
  test("an unrecognized_keys issue carries its offending names in issue.keys, never in issue.path", async () => {
    const error = refusalFor(ONE_UNKNOWN);
    const issue = error.issues[0];
    if (!issue) throw new Error("a strict schema refused with no issues at all");

    expect(issue.code).toBe("unrecognized_keys");
    expect(issue.path).toEqual([]);
    expect(unrecognizedKeysOf(issue)).toEqual(["projectId"]);

    const describeBodyRefusal = await loadDescribeBodyRefusal();
    const refusal = describeBodyRefusal(error);

    expect(refusal.status).toBe(400);
    expect(refusal.code).toBe("unrecognized_keys");
    expect(refusal.message).toContain("projectId");
  });

  test("flattenError puts the refusal in formErrors with an empty fieldErrors", async () => {
    const error = refusalFor(ONE_UNKNOWN);
    const flat = flattenOf(error);

    expect(flat.fieldErrors).toEqual({});
    expect(flat.formErrors.length).toBe(1);

    const describeBodyRefusal = await loadDescribeBodyRefusal();
    const refusal = describeBodyRefusal(error);
    expect(refusal.message.length).toBeGreaterThan(0);

    expect(refusal.message).not.toBe(flat.formErrors[0]);
    expect(refusal.message).not.toContain("Unrecognized key");
  });

  test("two unknown keys collapse into one issue carrying both names", async () => {
    const error = refusalFor(TWO_UNKNOWN);

    expect(error.issues.length).toBe(1);
    expect([...unrecognizedKeysOf(error.issues[0]!)].toSorted()).toEqual(
      ["organizationId", "projectId"].toSorted(),
    );

    const describeBodyRefusal = await loadDescribeBodyRefusal();
    const refusal = describeBodyRefusal(error);
    expect(refusal.message).toContain("projectId");
    expect(refusal.message).toContain("organizationId");
  });

  test("a null, undefined, array, string or number body refuses as invalid_type, not unrecognized_keys", async () => {
    const describeBodyRefusal = await loadDescribeBodyRefusal();

    for (const { label, body } of NON_OBJECT_BODIES) {
      const error = refusalFor(body);
      const issue = error.issues[0];
      if (!issue) throw new Error(`${label}: refused with no issues`);

      expect(`${label}:${issue.code}`).toBe(`${label}:invalid_type`);

      const refusal = describeBodyRefusal(error);
      expect(`${label}:${refusal.code}`).toBe(`${label}:invalid_body`);
      expect(`${label}:${refusal.status}`).toBe(`${label}:400`);
    }
  });
});

describe("the mapping's own obligations (AD-16)", () => {
  test("every refusal maps to a sentence from our table, for both issue codes", async () => {
    const describeBodyRefusal = await loadDescribeBodyRefusal();

    const bothCodes = [
      refusalFor(ONE_UNKNOWN),
      refusalFor(TWO_UNKNOWN),
      ...NON_OBJECT_BODIES.map((shape) => refusalFor(shape.body)),
    ];

    for (const error of bothCodes) {
      const refusal = describeBodyRefusal(error);

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

      expect(refusal.message).not.toMatch(/\b[45]\d\d\b/);
      expect(refusal.message).not.toMatch(/:\d+:\d+/);

      expect(refusal.status).toBe(400);
    }

    const codes = new Set(bothCodes.map((error) => describeBodyRefusal(error).code));
    expect([...codes].toSorted()).toEqual(["invalid_body", "unrecognized_keys"]);
  });

  test("the mapping throws on none of the six body shapes it exists to refuse", async () => {
    const describeBodyRefusal = await loadDescribeBodyRefusal();

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
