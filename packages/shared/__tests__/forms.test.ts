import { describe, expect, test } from "bun:test";

import { signInSchema, signUpSchema, workspaceNameSchema } from "../src/forms";

describe("workspaceNameSchema", () => {
  test("workspaceNameSchema rejects empty and whitespace-only names after trimming", () => {
    expect(workspaceNameSchema.safeParse("").success).toBe(false);
    expect(workspaceNameSchema.safeParse("   ").success).toBe(false);
    expect(workspaceNameSchema.safeParse("\t \n").success).toBe(false);

    // control: a real name survives trimming and parses
    expect(workspaceNameSchema.safeParse("  Ada's workspace  ").success).toBe(true);
  });
});

describe("signUpSchema and signInSchema", () => {
  test("sign-up and sign-in schemas reject missing email, malformed email, and short passwords", () => {
    const validSignUp = { name: "Ada", email: "ada@example.com", password: "longenough" };

    expect(signUpSchema.safeParse({ name: "Ada", password: "longenough" }).success).toBe(false); // missing email
    expect(signUpSchema.safeParse({ ...validSignUp, email: "not-an-email" }).success).toBe(false); // malformed email
    expect(signUpSchema.safeParse({ ...validSignUp, password: "short1" }).success).toBe(false); // short password (<8)
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true); // control: valid input parses

    const validSignIn = { email: "ada@example.com", password: "x" };

    expect(signInSchema.safeParse({ password: "x" }).success).toBe(false); // missing email
    expect(signInSchema.safeParse({ ...validSignIn, email: "not-an-email" }).success).toBe(false); // malformed email
    expect(signInSchema.safeParse({ email: "ada@example.com", password: "" }).success).toBe(false); // short (<1) password
    expect(signInSchema.safeParse(validSignIn).success).toBe(true); // control: valid input parses
  });
});
