// B-039: the one safe way to put a failed query in a log, and until this file the only
// function in the package with no direct test while eight call sites depended on it.
import { describe, expect, test } from "bun:test";

import { describeDriverError } from "../../src/repositories/driver-error";
import { driverQueryError } from "../../src/testing";

const STATEMENT = "update slack_connections set credential_ciphertext = $1 where id = $2";
const BOUND_SECRET = "v1.deadbeef.aaaa.bbbb.a-ciphertext-that-must-never-be-logged";
const ORG_ID = "org-6f1c0c0e";
const DRIVER_SAID = "deadlock detected";

const queryFailure = (driverMessage = DRIVER_SAID) =>
  driverQueryError({
    sql: STATEMENT,
    params: [BOUND_SECRET, ORG_ID],
    driverMessage,
  });

describe("describeDriverError", () => {
  test("CONTROL: the real driver error carries the statement and its parameters in `message`", () => {
    // The premise every row below rests on: a hand-built fixture asserts against a
    // shape the runtime never produces, and passes while the real error leaks.
    const failure = queryFailure();

    expect(failure.message).toContain(STATEMENT);
    expect(failure.message).toContain(BOUND_SECRET);
    expect(failure.message).toContain(ORG_ID);
  });

  test("a query failure is described by the driver's own words", () => {
    const described = describeDriverError(queryFailure());

    expect(described).toBe(DRIVER_SAID);
    expect(described).not.toContain(STATEMENT);
    expect(described).not.toContain(BOUND_SECRET);
    expect(described).not.toContain(ORG_ID);
  });

  test("a query failure WRAPPED one level down is refused too", () => {
    // Reading only the top level, the fallback preferred the cause message here.
    const wrapped = new Error("could not persist what it fetched", { cause: queryFailure() });
    const described = describeDriverError(wrapped);

    expect(described).not.toContain(STATEMENT);
    expect(described).not.toContain(BOUND_SECRET);
    expect(described).not.toContain(ORG_ID);
  });

  test("a query failure with no readable cause still names its code", () => {
    // The bare refusal is a sentence an operator can do nothing with.
    const blind = queryFailure("");
    Object.assign(blind.cause as object, { code: "40P01" });

    const described = describeDriverError(blind);

    expect(described).toContain("40P01");
    expect(described).not.toContain(STATEMENT);
    expect(described).not.toContain(BOUND_SECRET);
  });

  test("an ordinary error is described by its own message, unchanged", () => {
    expect(describeDriverError(new Error("the connection was closed"))).toBe(
      "the connection was closed",
    );
  });

  test("an ordinary error with an ordinary cause prefers the cause, which names the real fault", () => {
    const wrapped = new Error("could not reach the source", {
      cause: new Error("socket hang up"),
    });

    expect(describeDriverError(wrapped)).toBe("socket hang up");
  });

  test("a thrown string, a thrown object and null all describe without throwing", () => {
    for (const value of ["plain string", { nothing: "resembling an error" }, null, undefined]) {
      expect(typeof describeDriverError(value)).toBe("string");
    }
  });

  test("no shape in the corpus ever yields an empty description", () => {
    const corpus: readonly unknown[] = [
      queryFailure(),
      queryFailure(""),
      new Error("could not persist", { cause: queryFailure() }),
      new Error("plain"),
      new Error("outer", { cause: new Error("inner") }),
      "thrown string",
      null,
    ];

    for (const value of corpus) {
      expect(describeDriverError(value).length).toBeGreaterThan(0);
    }
  });
});
