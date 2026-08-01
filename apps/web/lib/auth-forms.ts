// THE ERROR STATE OF BOTH AUTH FORMS, AS PURE FUNCTIONS. `sign-up-form.tsx` and
// `sign-in-form.tsx` render what these return and decide nothing themselves.
//
// ###########################################################################
// # WHY THIS IS NOT INLINE IN THE TWO COMPONENTS, WHERE IT STARTED.
// #
// # It was, and the mapping shipped a wrong sentence for a year of edits with
// # nothing able to catch it: EVERY password issue was mapped to "Passwords need
// # at least 8 characters", so a 200-character password was told it was too
// # short. The schema's own "72 characters or fewer" existed and could never
// # reach a screen.
// #
// # That bug is not a typo, it is a shape. A `for` loop over Zod issues, sitting
// # inside a submit handler, inside a component with no DOM test harness, is
// # code that CANNOT BE ASSERTED ON — so the only proof it works is somebody
// # typing a long password into a browser, which nobody does. Pulled out here it
// # is eight exported functions with no React in them, and
// # `apps/web/__tests__/auth/auth-forms.test.ts` walks every branch.
// #
// # The rule this yields: an error-message decision belongs beside its schema,
// # not inside a component. If you add a field, add its mapping here.
// ###########################################################################
//
// ── WHAT A COMPONENT MAY RENDER ─────────────────────────────────────────────
//
// A CONSTANT FROM THIS FILE, AND NOTHING ELSE. Never `issue.message`, never a
// Better Auth code, never an exception's `.message`. Zod's own strings are
// developer-facing by default — the shape "Invalid input: expected string,
// received undefined" is one missing key away on either schema — and a raw
// error code on screen is a product-decisions §10 breach. The schemas keep
// sensible messages for callers that surface them directly (server-action
// logging); these two forms do not.
import {
  NETWORK_FAILURE_NOTICE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signInSchema,
  signUpSchema,
  type SignInInput,
  type SignUpInput,
} from "@growthmind/shared";

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

export const NAME_REQUIRED_MESSAGE = "Enter your name";

export const NAME_TOO_LONG_MESSAGE = "That name is too long";

export const EMAIL_INVALID_MESSAGE = "Enter a valid email address";

/**
 * The two password bounds, INTERPOLATED FROM THE SCHEMA'S OWN CONSTANTS.
 *
 * A hand-typed "8" here is a number that drifts the day somebody raises the
 * minimum — and drifts silently, because the form would still reject correctly
 * while telling the person a different rule than the one that rejected them.
 * The bounds have one home (`packages/shared/src/forms.ts`) and these sentences
 * read it.
 */
export const PASSWORD_TOO_SHORT_MESSAGE = `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`;

export const PASSWORD_TOO_LONG_MESSAGE = `Passwords need to be ${PASSWORD_MAX_LENGTH} characters or fewer.`;

/** Sign-in only. Presence, not strength — an existing short password must submit. */
export const PASSWORD_REQUIRED_MESSAGE = "Enter your password";

/**
 * ONE SENTENCE FOR BOTH SIGN-IN FAILURES, deliberately.
 *
 * Better Auth's `/sign-in/email` throws the same `INVALID_EMAIL_OR_PASSWORD`
 * whether the email is unknown or the password is wrong (verified in its
 * `sign-in.mjs`), and this copy keeps that property on the screen: a form that
 * says "no account with that email" is an account-enumeration oracle.
 */
export const CREDENTIAL_MISMATCH_MESSAGE = "That email and password don't match — try again?";

/** The one home for this line is `packages/shared`; both forms borrow it. */
export const NETWORK_FAILURE_MESSAGE = NETWORK_FAILURE_NOTICE;

/**
 * THE UN-MAPPABLE VALIDATION FAILURE. Nobody should ever see this sentence.
 *
 * Every issue either schema can raise has a `path[0]` in the mapped set, and
 * `auth-forms.test.ts` pins that both ways. It exists because the alternative
 * failure mode is silent: an all-null error record renders nothing at all while
 * the submit handler still returns early, so the button would simply stop
 * working with no explanation on screen and no error in the console. A sentence
 * nobody should see beats a dead form.
 */
export const CHECK_DETAILS_MESSAGE = "Check the details above and try again.";

/**
 * Not copy — a SENTINEL. The duplicate-email case renders as a node carrying a
 * "sign in instead?" link, which a plain string cannot express, so the form
 * branches on this value rather than on a message it would then have to match.
 */
export const DUPLICATE_EMAIL = "duplicate";

// ---------------------------------------------------------------------------
// The error records
// ---------------------------------------------------------------------------

/** Field errors sit on their field; anything with no field sits on `form`. */
interface FormLevel {
  readonly form: string | null;
}

export interface SignUpErrors extends FormLevel {
  readonly name: string | null;
  /** A message, or `DUPLICATE_EMAIL`. */
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

// ---------------------------------------------------------------------------
// Client-side validation — what runs before anything reaches the network
// ---------------------------------------------------------------------------

/**
 * Which sentence a password issue earns.
 *
 * KEYED ON THE ISSUE CODE, which is the whole fix: `too_small` and `too_big` are
 * different facts about the same field and the person typing needs to be told
 * which one they hit. `invalid_type` (a non-string) is unreachable from a
 * controlled input and lands on the minimum, which is the more useful nudge of
 * the two if it ever somehow arrives.
 */
const passwordMessage = (code: string): string =>
  code === "too_big" ? PASSWORD_TOO_LONG_MESSAGE : PASSWORD_TOO_SHORT_MESSAGE;

const nameMessage = (code: string): string =>
  code === "too_big" ? NAME_TOO_LONG_MESSAGE : NAME_REQUIRED_MESSAGE;

/** Did the walk below actually produce something renderable? See `CHECK_DETAILS_MESSAGE`. */
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

/**
 * Valid, WITH THE CANONICAL VALUES — or rejected, with the sentences to show.
 *
 * The `values` on the accepting arm are the schema's output, not the raw input:
 * `name` arrives trimmed. Returning them is what stops the caller re-deriving
 * the same normalisation beside the call and getting it subtly different — the
 * form submits what the validator approved, or it does not submit.
 */
export type SignUpValidation =
  | { readonly ok: true; readonly values: SignUpInput }
  | { readonly ok: false; readonly errors: SignUpErrors };

export type SignInValidation =
  | { readonly ok: true; readonly values: SignInInput }
  | { readonly ok: false; readonly errors: SignInErrors };

/**
 * The sign-up form's client-side gate.
 *
 * FIRST ISSUE PER FIELD WINS. Zod can raise more than one on a field, and a
 * `TextInput` renders exactly one — showing the last would mean the sentence
 * changes depending on the order Zod happens to walk its checks.
 */
export function validateSignUp(values: SignUpValues): SignUpValidation {
  const parsed = signUpSchema.safeParse(values);
  if (parsed.success) return { ok: true, values: parsed.data };

  let name: string | null = null;
  let email: string | null = null;
  let password: string | null = null;

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];

    // `??=` IS THE "first issue wins" RULE, spelled as one operator.
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

/**
 * The sign-in form's client-side gate.
 *
 * PRESENCE AND FORMAT ONLY — never a credential judgement, so field-level
 * display here does not leak which of the two was wrong. The password rule is
 * `min(1)` on purpose: a user whose account predates the 8-character minimum
 * must still be able to sign in.
 */
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

// ---------------------------------------------------------------------------
// Server-side failures — what Better Auth hands back
// ---------------------------------------------------------------------------

/**
 * Better Auth surfaces the machine-readable failure reason on `error.body.code`
 * (confirmed against the server-side `APIError` shape pinned by
 * `apps/web/__tests__/tenancy/signup-org.test.ts`). Read defensively through
 * `unknown`: the client fetch wrapper's error type is a loose
 * `Record<string, any>` union, and a top-level `.code` is also accepted in case
 * the client normalises the shape differently than the server-side throw.
 */
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

/**
 * The shipped `/sign-up/email` route throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`
 * (`better-auth/dist/api/routes/sign-up.mjs`). `USER_ALREADY_EXISTS` is the same
 * fact spelled shorter, raised by the admin plugin this app does not register —
 * mapped anyway because the cost is a list entry and the cost of missing it is a
 * duplicate signup being told the server was unreachable.
 */
const DUPLICATE_EMAIL_CODES = new Set([
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "USER_ALREADY_EXISTS",
]);

/**
 * A failed `signUp.email` call, as field errors.
 *
 * ANYTHING UNRECOGNISED IS THE NETWORK LINE. An unknown code, a malformed error
 * object and a genuine fetch rejection are indistinguishable to the person
 * looking at the screen, and all three mean "we did not get an answer" — so they
 * get one sentence and no code ever reaches the screen.
 */
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

/**
 * A failed `signIn.email` call.
 *
 * ALWAYS FORM-LEVEL, NEVER A FIELD. A field error would point at one of the two
 * inputs, which is exactly the disclosure `CREDENTIAL_MISMATCH_MESSAGE` exists
 * to avoid — the code carries no such distinction and neither may the screen.
 */
export function signInSubmitErrors(error: unknown): SignInErrors {
  const code = readErrorCode(error);

  return {
    ...NO_SIGN_IN_ERRORS,
    form:
      code === "INVALID_EMAIL_OR_PASSWORD" ? CREDENTIAL_MISMATCH_MESSAGE : NETWORK_FAILURE_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Editing after a failure
// ---------------------------------------------------------------------------

/**
 * Clear one field's error — and the form-level line with it — as the user types.
 *
 * WHY THE FORM LINE GOES TOO. After a failed sign-in the screen says "That email
 * and password don't match"; the moment the person edits either box that
 * sentence is about a submission that no longer exists. Leaving it up reads as
 * "still wrong" while they are mid-fix, which is the state that makes people
 * give up on a password they actually know.
 *
 * RETURNS THE SAME REFERENCE WHEN THERE IS NOTHING TO CLEAR, so the usual
 * `setErrors((current) => clearField(current, "email"))` bails out of the render
 * instead of allocating a new identical object on every keystroke.
 */
export function clearField<E extends FormLevel>(errors: E, field: Exclude<keyof E, "form">): E {
  if (errors[field] === null && errors.form === null) {
    return errors;
  }

  // The computed key is `keyof E` by construction; TypeScript widens a spread
  // with a computed property and cannot see that the result is still an `E`.
  return { ...errors, [field]: null, form: null } as E;
}
