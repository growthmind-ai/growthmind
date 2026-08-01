// THE SIGN-UP AND SIGN-IN FORMS' ERROR STATE. `apps/web/lib/auth-forms.ts`.
//
// These two forms were the last customer-facing surface in `apps/web` with no
// assertions on what they SAY. The mapping they used to carry inline sent one
// wrong sentence to the screen for a year of edits — every password issue was
// rendered as "Passwords need at least 8 characters", so a 200-character
// password was told it was too short — and nothing in the suite could have
// noticed, because the mapping lived inside a submit handler in a component
// with no DOM harness.
//
// Row 3 below is that bug, made impossible. The rest are the branches that were
// unasserted beside it: which sentence each Zod issue earns, which Better Auth
// code lands where, and the two disclosure rules (never say WHICH credential was
// wrong, never render a raw Zod message or an error code).
import { describe, expect, test } from "bun:test";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, signUpSchema } from "@growthmind/shared";

import {
  CHECK_DETAILS_MESSAGE,
  clearField,
  CREDENTIAL_MISMATCH_MESSAGE,
  DUPLICATE_EMAIL,
  EMAIL_INVALID_MESSAGE,
  NAME_REQUIRED_MESSAGE,
  NAME_TOO_LONG_MESSAGE,
  NETWORK_FAILURE_MESSAGE,
  NO_SIGN_IN_ERRORS,
  NO_SIGN_UP_ERRORS,
  PASSWORD_REQUIRED_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  readErrorCode,
  signInSubmitErrors,
  signUpSubmitErrors,
  validateSignIn,
  validateSignUp,
  type SignInErrors,
  type SignUpErrors,
} from "../../lib/auth-forms";

const VALID_SIGN_UP = { name: "Ada", email: "ada@example.com", password: "longenough" };
const VALID_SIGN_IN = { email: "ada@example.com", password: "longenough" };

/** The errors from a rejection, or a failure naming what was accepted instead. */
const signUpErrors = (values: typeof VALID_SIGN_UP): SignUpErrors => {
  const result = validateSignUp(values);
  if (result.ok) throw new Error(`expected a rejection, got ${JSON.stringify(result.values)}`);
  return result.errors;
};

const signInErrors = (values: typeof VALID_SIGN_IN): SignInErrors => {
  const result = validateSignIn(values);
  if (result.ok) throw new Error(`expected a rejection, got ${JSON.stringify(result.values)}`);
  return result.errors;
};

// ###########################################################################
describe("sign-up validation", () => {
  test("valid input is accepted and returns the schema's own canonical values", () => {
    const result = validateSignUp({ ...VALID_SIGN_UP, name: "  Ada  " });

    expect(result.ok).toBe(true);
    // The form submits THIS, never the raw state — so the trim happens once, in
    // the schema, rather than a second time beside the call.
    if (result.ok) {
      expect(result.values).toEqual({ ...VALID_SIGN_UP, name: "Ada" });
    }
  });

  test("an empty name is required, a 201-character name is too long", () => {
    expect(signUpErrors({ ...VALID_SIGN_UP, name: "   " }).name).toBe(NAME_REQUIRED_MESSAGE);
    expect(signUpErrors({ ...VALID_SIGN_UP, name: "a".repeat(201) }).name).toBe(
      NAME_TOO_LONG_MESSAGE,
    );
  });

  test("a malformed or missing email earns the email sentence", () => {
    expect(signUpErrors({ ...VALID_SIGN_UP, email: "not-an-email" }).email).toBe(
      EMAIL_INVALID_MESSAGE,
    );
    expect(signUpErrors({ ...VALID_SIGN_UP, email: "" }).email).toBe(EMAIL_INVALID_MESSAGE);
  });

  // ---- THE REGRESSION. This is the bug this module was extracted for. ------
  test("a too-long password is told it is too LONG, not that it is too short", () => {
    const tooLong = "a".repeat(PASSWORD_MAX_LENGTH + 1);
    const errors = signUpErrors({ ...VALID_SIGN_UP, password: tooLong });

    expect(errors.password).toBe(PASSWORD_TOO_LONG_MESSAGE);
    // The precise shape of the old bug: the maximum reported as the minimum.
    expect(errors.password).not.toBe(PASSWORD_TOO_SHORT_MESSAGE);
    // ...and the schema really does reject it, so the row is not vacuous.
    expect(signUpSchema.safeParse({ ...VALID_SIGN_UP, password: tooLong }).success).toBe(false);
  });

  test("a too-short password is told it is too short, and the boundary is exact", () => {
    expect(
      signUpErrors({ ...VALID_SIGN_UP, password: "a".repeat(PASSWORD_MIN_LENGTH - 1) }).password,
    ).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(signUpErrors({ ...VALID_SIGN_UP, password: "" }).password).toBe(
      PASSWORD_TOO_SHORT_MESSAGE,
    );

    // Both bounds are INCLUSIVE — the two values a person actually lands on.
    expect(validateSignUp({ ...VALID_SIGN_UP, password: "a".repeat(PASSWORD_MIN_LENGTH) }).ok).toBe(
      true,
    );
    expect(validateSignUp({ ...VALID_SIGN_UP, password: "a".repeat(PASSWORD_MAX_LENGTH) }).ok).toBe(
      true,
    );
  });

  test("the two password sentences state the schema's own numbers", () => {
    // D9/D12: the copy interpolates the exported bounds, so raising the minimum
    // cannot leave a sentence quoting the old one. This row fails the moment
    // somebody re-types a literal into either message.
    expect(PASSWORD_TOO_SHORT_MESSAGE).toContain(String(PASSWORD_MIN_LENGTH));
    expect(PASSWORD_TOO_LONG_MESSAGE).toContain(String(PASSWORD_MAX_LENGTH));
  });

  test("every field is reported at once, so a fix is one pass and not three", () => {
    expect(signUpErrors({ name: "", email: "nope", password: "x" })).toEqual({
      name: NAME_REQUIRED_MESSAGE,
      email: EMAIL_INVALID_MESSAGE,
      password: PASSWORD_TOO_SHORT_MESSAGE,
      form: null,
    });
  });

  test("a rejection always carries something renderable", () => {
    // The dead-form guard: an all-null record would render nothing while the
    // submit handler still returned early. Every rejection this schema can
    // produce is renderable, and `CHECK_DETAILS_MESSAGE` is the floor if one
    // ever is not.
    for (const values of [
      { name: "", email: "", password: "" },
      { name: "a".repeat(201), email: "nope", password: "a".repeat(999) },
      { ...VALID_SIGN_UP, email: "  " },
    ]) {
      const errors = signUpErrors(values);
      expect(Object.values(errors).some((value) => value !== null)).toBe(true);
    }

    // ...and the floor sentence is not itself reachable on any of them, which is
    // what proves the mapping is total rather than falling through.
    expect(signUpErrors({ name: "", email: "", password: "" }).form).toBeNull();
    expect(CHECK_DETAILS_MESSAGE.length).toBeGreaterThan(0);
  });
});

// ###########################################################################
describe("sign-in validation", () => {
  test("valid input is accepted", () => {
    expect(validateSignIn(VALID_SIGN_IN)).toEqual({ ok: true, values: VALID_SIGN_IN });
  });

  test("a short password still signs in — the 8-character rule is sign-up only", () => {
    // An account created before the minimum existed must not be locked out by a
    // client-side gate its owner cannot do anything about.
    expect(validateSignIn({ ...VALID_SIGN_IN, password: "x" }).ok).toBe(true);
  });

  test("an empty password asks for one; a malformed email earns the email sentence", () => {
    expect(signInErrors({ ...VALID_SIGN_IN, password: "" }).password).toBe(
      PASSWORD_REQUIRED_MESSAGE,
    );
    expect(signInErrors({ ...VALID_SIGN_IN, email: "not-an-email" }).email).toBe(
      EMAIL_INVALID_MESSAGE,
    );
  });

  test("client-side rejections never carry the credential sentence", () => {
    // Presence and format are facts about what was typed, not about whether an
    // account exists — so they may point at a field. The credential mismatch may
    // not, and must never arrive from this side at all.
    const errors = signInErrors({ email: "nope", password: "" });
    expect(Object.values(errors)).not.toContain(CREDENTIAL_MISMATCH_MESSAGE);
  });
});

// ###########################################################################
describe("reading a Better Auth failure", () => {
  test("the code is read from body.code, from a top-level code, or not at all", () => {
    expect(readErrorCode({ body: { code: "PASSWORD_TOO_SHORT" } })).toBe("PASSWORD_TOO_SHORT");
    expect(readErrorCode({ code: "PASSWORD_TOO_SHORT" })).toBe("PASSWORD_TOO_SHORT");
    // body.code wins — it is where the server-side `APIError` actually puts it.
    expect(readErrorCode({ body: { code: "A" }, code: "B" })).toBe("A");

    for (const shape of [
      null,
      undefined,
      "PASSWORD_TOO_SHORT",
      42,
      {},
      { body: null },
      { code: 7 },
    ]) {
      expect(readErrorCode(shape)).toBeUndefined();
    }
  });
});

// ###########################################################################
describe("sign-up submit failures", () => {
  test("a duplicate email is flagged on the email field with the link sentinel", () => {
    // Both spellings: the shipped `/sign-up/email` route throws the long one,
    // the admin plugin the short one.
    for (const code of ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "USER_ALREADY_EXISTS"]) {
      expect(signUpSubmitErrors({ body: { code } })).toEqual({
        ...NO_SIGN_UP_ERRORS,
        email: DUPLICATE_EMAIL,
      });
    }
  });

  test("the server's own password verdicts land on the password field", () => {
    expect(signUpSubmitErrors({ body: { code: "PASSWORD_TOO_SHORT" } }).password).toBe(
      PASSWORD_TOO_SHORT_MESSAGE,
    );
    expect(signUpSubmitErrors({ body: { code: "PASSWORD_TOO_LONG" } }).password).toBe(
      PASSWORD_TOO_LONG_MESSAGE,
    );
  });

  test("an unknown code, a malformed error and a thrown fetch all read as unreachable", () => {
    // D5/D8: these are indistinguishable to the person looking at the screen and
    // all mean "we did not get an answer". One sentence, and never a code.
    for (const error of [
      { body: { code: "SOMETHING_NEW_IN_A_MINOR_BUMP" } },
      new TypeError("Failed to fetch"),
      null,
      undefined,
      {},
    ]) {
      expect(signUpSubmitErrors(error)).toEqual({
        ...NO_SIGN_UP_ERRORS,
        form: NETWORK_FAILURE_MESSAGE,
      });
    }
  });
});

// ###########################################################################
describe("sign-in submit failures", () => {
  test("a credential mismatch is form-level, never on a field", () => {
    const errors = signInSubmitErrors({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });

    expect(errors.form).toBe(CREDENTIAL_MISMATCH_MESSAGE);
    // THE DISCLOSURE RULE. Better Auth throws one code for "no such email" and
    // "wrong password" deliberately; a field-level error would put the
    // distinction back on the screen and turn the form into an
    // account-enumeration oracle.
    expect(errors.email).toBeNull();
    expect(errors.password).toBeNull();
  });

  test("anything else reads as unreachable, and no code ever reaches the screen", () => {
    for (const error of [
      { body: { code: "USER_NOT_FOUND" } },
      new TypeError("Failed to fetch"),
      null,
      {},
    ]) {
      expect(signInSubmitErrors(error)).toEqual({
        ...NO_SIGN_IN_ERRORS,
        form: NETWORK_FAILURE_MESSAGE,
      });
    }
  });
});

// ###########################################################################
describe("clearing an error as the user types", () => {
  const failed: SignInErrors = {
    email: EMAIL_INVALID_MESSAGE,
    password: PASSWORD_REQUIRED_MESSAGE,
    form: CREDENTIAL_MISMATCH_MESSAGE,
  };

  test("editing a field clears that field AND the form line, leaving the others", () => {
    expect(clearField(failed, "email")).toEqual({
      email: null,
      password: PASSWORD_REQUIRED_MESSAGE,
      form: null,
    });
  });

  test("the form line goes even when the edited field had no error of its own", () => {
    // The case the rule exists for: sign-in fails with a form-level mismatch and
    // no field errors at all. Typing into either box must take that sentence
    // down, or it reads as "still wrong" while the person is mid-fix.
    const mismatchOnly: SignInErrors = { ...NO_SIGN_IN_ERRORS, form: CREDENTIAL_MISMATCH_MESSAGE };

    expect(clearField(mismatchOnly, "password")).toEqual(NO_SIGN_IN_ERRORS);
  });

  test("clearing nothing returns the SAME object, so a keystroke is not a render", () => {
    // `setErrors((current) => clearField(current, "email"))` runs on every
    // keystroke. React bails out on `Object.is`, so identity here is the
    // difference between a re-render per character and none.
    expect(clearField(NO_SIGN_IN_ERRORS, "email")).toBe(NO_SIGN_IN_ERRORS);
    expect(clearField(NO_SIGN_UP_ERRORS, "password")).toBe(NO_SIGN_UP_ERRORS);

    const cleared = clearField(failed, "email");
    expect(clearField(cleared, "email")).toBe(cleared);
  });

  test("it works on the sign-up record too, including the duplicate sentinel", () => {
    const duplicate: SignUpErrors = { ...NO_SIGN_UP_ERRORS, email: DUPLICATE_EMAIL };

    expect(clearField(duplicate, "email")).toEqual(NO_SIGN_UP_ERRORS);
    // Editing the name must NOT take down the duplicate-email flag.
    expect(clearField(duplicate, "name")).toEqual(duplicate);
  });
});
