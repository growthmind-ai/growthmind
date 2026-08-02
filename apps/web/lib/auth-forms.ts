import {
  NETWORK_FAILURE_NOTICE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signInSchema,
  signUpSchema,
  type SignInInput,
  type SignUpInput,
} from "@growthmind/shared";

export const NAME_REQUIRED_MESSAGE = "Enter your name";

export const NAME_TOO_LONG_MESSAGE = "That name is too long";

export const EMAIL_INVALID_MESSAGE = "Enter a valid email address";

export const PASSWORD_TOO_SHORT_MESSAGE = `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`;

export const PASSWORD_TOO_LONG_MESSAGE = `Passwords need to be ${PASSWORD_MAX_LENGTH} characters or fewer.`;

export const PASSWORD_REQUIRED_MESSAGE = "Enter your password";

export const CREDENTIAL_MISMATCH_MESSAGE = "That email and password don't match — try again?";

export const NETWORK_FAILURE_MESSAGE = NETWORK_FAILURE_NOTICE;

export const CHECK_DETAILS_MESSAGE = "Check the details above and try again.";

export const DUPLICATE_EMAIL = "duplicate";

interface FormLevel {
  readonly form: string | null;
}

export interface SignUpErrors extends FormLevel {
  readonly name: string | null;

  readonly email: string | null;
  readonly password: string | null;
}

export interface SignInErrors extends FormLevel {
  readonly email: string | null;
  readonly password: string | null;
}

export const NO_SIGN_UP_ERRORS: SignUpErrors = {
  name: null,
  email: null,
  password: null,
  form: null,
};

export const NO_SIGN_IN_ERRORS: SignInErrors = { email: null, password: null, form: null };

const passwordMessage = (code: string): string =>
  code === "too_big" ? PASSWORD_TOO_LONG_MESSAGE : PASSWORD_TOO_SHORT_MESSAGE;

const nameMessage = (code: string): string =>
  code === "too_big" ? NAME_TOO_LONG_MESSAGE : NAME_REQUIRED_MESSAGE;

const hasAny = (errors: SignUpErrors | SignInErrors): boolean =>
  Object.values(errors).some((value) => value !== null);

export interface SignUpValues {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface SignInValues {
  readonly email: string;
  readonly password: string;
}

export type SignUpValidation =
  | { readonly ok: true; readonly values: SignUpInput }
  | { readonly ok: false; readonly errors: SignUpErrors };

export type SignInValidation =
  | { readonly ok: true; readonly values: SignInInput }
  | { readonly ok: false; readonly errors: SignInErrors };

export function validateSignUp(values: SignUpValues): SignUpValidation {
  const parsed = signUpSchema.safeParse(values);
  if (parsed.success) return { ok: true, values: parsed.data };

  let name: string | null = null;
  let email: string | null = null;
  let password: string | null = null;

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];

    if (field === "name") name ??= nameMessage(issue.code);
    else if (field === "email") email ??= EMAIL_INVALID_MESSAGE;
    else if (field === "password") password ??= passwordMessage(issue.code);
  }

  const errors: SignUpErrors = { name, email, password, form: null };

  return {
    ok: false,
    errors: hasAny(errors) ? errors : { ...NO_SIGN_UP_ERRORS, form: CHECK_DETAILS_MESSAGE },
  };
}

export function validateSignIn(values: SignInValues): SignInValidation {
  const parsed = signInSchema.safeParse(values);
  if (parsed.success) return { ok: true, values: parsed.data };

  let email: string | null = null;
  let password: string | null = null;

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];

    if (field === "email") email ??= EMAIL_INVALID_MESSAGE;
    else if (field === "password") password ??= PASSWORD_REQUIRED_MESSAGE;
  }

  const errors: SignInErrors = { email, password, form: null };

  return {
    ok: false,
    errors: hasAny(errors) ? errors : { ...NO_SIGN_IN_ERRORS, form: CHECK_DETAILS_MESSAGE },
  };
}

export function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const body = (error as { body?: unknown }).body;
  if (body && typeof body === "object") {
    const bodyCode = (body as { code?: unknown }).code;
    if (typeof bodyCode === "string") {
      return bodyCode;
    }
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

const DUPLICATE_EMAIL_CODES = new Set([
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "USER_ALREADY_EXISTS",
]);

export function signUpSubmitErrors(error: unknown): SignUpErrors {
  const code = readErrorCode(error);

  if (code !== undefined && DUPLICATE_EMAIL_CODES.has(code)) {
    return { ...NO_SIGN_UP_ERRORS, email: DUPLICATE_EMAIL };
  }
  if (code === "PASSWORD_TOO_SHORT") {
    return { ...NO_SIGN_UP_ERRORS, password: PASSWORD_TOO_SHORT_MESSAGE };
  }
  if (code === "PASSWORD_TOO_LONG") {
    return { ...NO_SIGN_UP_ERRORS, password: PASSWORD_TOO_LONG_MESSAGE };
  }

  return { ...NO_SIGN_UP_ERRORS, form: NETWORK_FAILURE_MESSAGE };
}

export function signInSubmitErrors(error: unknown): SignInErrors {
  const code = readErrorCode(error);

  return {
    ...NO_SIGN_IN_ERRORS,
    form:
      code === "INVALID_EMAIL_OR_PASSWORD" ? CREDENTIAL_MISMATCH_MESSAGE : NETWORK_FAILURE_MESSAGE,
  };
}

export function clearField<E extends FormLevel>(errors: E, field: Exclude<keyof E, "form">): E {
  if (errors[field] === null && errors.form === null) {
    return errors;
  }

  return { ...errors, [field]: null, form: null } as E;
}
