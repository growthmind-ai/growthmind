import { describe, expect, test } from "bun:test";

import { resolveLastLoginBadge } from "../../lib/last-login-method";
import type { SocialProviderId } from "../../lib/social-auth";

const BOTH: readonly SocialProviderId[] = ["google", "github"];
const NONE: readonly SocialProviderId[] = [];

// The cookie is written by Better Auth on a provider callback and read on the next visit,
// so every value here is one a real browser can arrive with — including the ones written
// by methods this app does not offer, and the ones naming a provider since switched off.
describe("which control the last-used marker lands on", () => {
  test("a first-time visitor carries no cookie, and nothing is marked", () => {
    expect(resolveLastLoginBadge(undefined, BOTH)).toBeNull();
  });

  test("an empty cookie is not a method", () => {
    expect(resolveLastLoginBadge("", BOTH)).toBeNull();
  });

  test("a method this app does not offer marks nothing rather than guessing a control", () => {
    expect(resolveLastLoginBadge("passkey", BOTH)).toBeNull();
    expect(resolveLastLoginBadge("magic-link", BOTH)).toBeNull();
    expect(resolveLastLoginBadge("siwe", BOTH)).toBeNull();
  });

  // The cookie is httpOnly:false by design — the browser can read it, so the browser can
  // also write it. Nothing from it is ever rendered: it only picks which fixed control
  // carries a fixed label, and a value naming no control picks none.
  test("a hand-edited cookie cannot put anything of its own on the screen", () => {
    expect(resolveLastLoginBadge("<script>alert(1)</script>", BOTH)).toBeNull();
    expect(resolveLastLoginBadge("google github", BOTH)).toBeNull();
    expect(resolveLastLoginBadge("GOOGLE", BOTH)).toBeNull();
  });

  test("each configured provider is marked by its own name", () => {
    expect(resolveLastLoginBadge("google", BOTH)).toBe("google");
    expect(resolveLastLoginBadge("github", BOTH)).toBe("github");
  });

  test("a provider whose credentials were pulled leaves no marker behind", () => {
    expect(resolveLastLoginBadge("github", ["google"])).toBeNull();
    expect(resolveLastLoginBadge("google", NONE)).toBeNull();
  });

  test("email survives an install with no social provider at all — it is always enabled", () => {
    expect(resolveLastLoginBadge("email", NONE)).toBe("email");
    expect(resolveLastLoginBadge("email", BOTH)).toBe("email");
  });
});
