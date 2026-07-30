import { z } from "zod";

/**
 * Validation shapes for the sign-up/sign-in forms and the P1 workspace
 * rename action (ADD D-H). Forms render these failures as plain-English
 * strings from the UX spec — raw Zod messages never reach the screen — but
 * the messages below still carry sensible defaults for any caller that
 * surfaces them directly (e.g. server-action logging).
 */

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const workspaceNameSchema = z.string().trim().min(1, "Enter a workspace name");

export type WorkspaceName = z.infer<typeof workspaceNameSchema>;
