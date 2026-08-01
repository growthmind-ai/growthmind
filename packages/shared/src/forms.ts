import { z } from "zod";

/**
 * Validation shapes for the sign-up/sign-in forms and the P1 workspace rename action.
 * Forms render these failures as plain-English strings from the UX spec (raw Zod
 * messages never reach the screen) but the messages below still carry sensible defaults
 * for any caller that surfaces them directly (e.g. server-action logging).
 */

// Upper bounds are storage/DoS guards, not product rules: without them an arbitrarily
// large string flows into a `text` column and back out in every response that renders
// it. The 72-byte password cap matches the bcrypt-family input limit, so nothing
// silently truncates below the hash boundary.

/**
 * The password bounds, as numbers rather than literals buried in the schema.
 *
 * The sign-up form's error copy states these limits to the person typing, and a
 * copy string that names a different number than the rule that rejected them is
 * worse than no number at all. `apps/web/lib/auth-forms.ts` interpolates these
 * two constants into that copy, so the schema and the sentence cannot disagree.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200, "That name is too long"),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a workspace name")
  .max(100, "That workspace name is too long");

export type WorkspaceName = z.infer<typeof workspaceNameSchema>;
