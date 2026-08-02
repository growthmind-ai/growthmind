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

describe("sign-up validation", () => {
  test("valid input is accepted and returns the schema's own canonical values", () => {
    const result = validateSignUp({ ...VALID_SIGN_UP, name: "  Ada  " });

    expect(result.ok).toBe(true);

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

  test("a too-long password is told it is too LONG, not that it is too short", () => {
    const tooLong = "a".repeat(PASSWORD_MAX_LENGTH + 1);
    const errors = signUpErrors({ ...VALID_SIGN_UP, password: tooLong });

    expect(errors.password).toBe(PASSWORD_TOO_LONG_MESSAGE);

    expect(errors.password).not.toBe(PASSWORD_TOO_SHORT_MESSAGE);

    expect(signUpSchema.safeParse({ ...VALID_SIGN_UP, password: tooLong }).success).toBe(false);
  });

  test("a too-short password is told it is too short, and the boundary is exact", () => {
    expect(
      signUpErrors({ ...VALID_SIGN_UP, password: "a".repeat(PASSWORD_MIN_LENGTH - 1) }).password,
    ).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(signUpErrors({ ...VALID_SIGN_UP, password: "" }).password).toBe(
      PASSWORD_TOO_SHORT_MESSAGE,
    );

    expect(validateSignUp({ ...VALID_SIGN_UP, password: "a".repeat(PASSWORD_MIN_LENGTH) }).ok).toBe(
      true,
    );
    expect(validateSignUp({ ...VALID_SIGN_UP, password: "a".repeat(PASSWORD_MAX_LENGTH) }).ok).toBe(
      true,
    );
  });

  test("the two password sentences state the schema's own numbers", () => {
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
    for (const values of [
      { name: "", email: "", password: "" },
      { name: "a".repeat(201), email: "nope", password: "a".repeat(999) },
      { ...VALID_SIGN_UP, email: "  " },
    ]) {
      const errors = signUpErrors(values);
      expect(Object.values(errors).some((value) => value !== null)).toBe(true);
    }

    expect(signUpErrors({ name: "", email: "", password: "" }).form).toBeNull();
    expect(CHECK_DETAILS_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe("sign-in validation", () => {
  test("valid input is accepted", () => {
    expect(validateSignIn(VALID_SIGN_IN)).toEqual({ ok: true, values: VALID_SIGN_IN });
  });

  test("a short password still signs in — the 8-character rule is sign-up only", () => {
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
    const errors = signInErrors({ email: "nope", password: "" });
    expect(Object.values(errors)).not.toContain(CREDENTIAL_MISMATCH_MESSAGE);
  });
});

describe("reading a Better Auth failure", () => {
  test("the code is read from body.code, from a top-level code, or not at all", () => {
    expect(readErrorCode({ body: { code: "PASSWORD_TOO_SHORT" } })).toBe("PASSWORD_TOO_SHORT");
    expect(readErrorCode({ code: "PASSWORD_TOO_SHORT" })).toBe("PASSWORD_TOO_SHORT");

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

describe("sign-up submit failures", () => {
  test("a duplicate email is flagged on the email field with the link sentinel", () => {
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

describe("sign-in submit failures", () => {
  test("a credential mismatch is form-level, never on a field", () => {
    const errors = signInSubmitErrors({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });

    expect(errors.form).toBe(CREDENTIAL_MISMATCH_MESSAGE);

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
    const mismatchOnly: SignInErrors = { ...NO_SIGN_IN_ERRORS, form: CREDENTIAL_MISMATCH_MESSAGE };

    expect(clearField(mismatchOnly, "password")).toEqual(NO_SIGN_IN_ERRORS);
  });

  test("clearing nothing returns the SAME object, so a keystroke is not a render", () => {
    expect(clearField(NO_SIGN_IN_ERRORS, "email")).toBe(NO_SIGN_IN_ERRORS);
    expect(clearField(NO_SIGN_UP_ERRORS, "password")).toBe(NO_SIGN_UP_ERRORS);

    const cleared = clearField(failed, "email");
    expect(clearField(cleared, "email")).toBe(cleared);
  });

  test("it works on the sign-up record too, including the duplicate sentinel", () => {
    const duplicate: SignUpErrors = { ...NO_SIGN_UP_ERRORS, email: DUPLICATE_EMAIL };

    expect(clearField(duplicate, "email")).toEqual(NO_SIGN_UP_ERRORS);

    expect(clearField(duplicate, "name")).toEqual(duplicate);
  });
});
