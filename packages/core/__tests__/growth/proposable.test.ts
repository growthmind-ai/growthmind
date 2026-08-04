import { describe, expect, test } from "bun:test";

import { EMPTY_PROPOSAL_SCOPE, isProposableSurface } from "../../src/growth/proposable";
import type { ForbiddenReason } from "@growthmind/shared";

function verdictFor(surface: string): ReturnType<typeof isProposableSurface> {
  return isProposableSurface(surface, EMPTY_PROPOSAL_SCOPE);
}

function refusalOf(surface: string): ForbiddenReason {
  const verdict = verdictFor(surface);
  if (verdict.proposable) {
    throw new Error(`expected ${surface} to be refused`);
  }
  return verdict.reason;
}

describe("isProposableSurface", () => {
  test("refuses the surfaces §5 names, by the kind of page they are", () => {
    expect(refusalOf("/pricing")).toBe("pricing_or_billing");
    expect(refusalOf("/settings/billing")).toBe("pricing_or_billing");
    expect(refusalOf("/checkout")).toBe("pricing_or_billing");
    expect(refusalOf("/login")).toBe("auth");
    expect(refusalOf("/account/password")).toBe("auth");
    expect(refusalOf("/legal/terms")).toBe("consent_or_terms");
    expect(refusalOf("/cookie-policy")).toBe("consent_or_terms");
  });

  test("matches inside a segment, so a renamed money page is still refused", () => {
    // The near-miss the taxonomy names: a checkout flow that is not called checkout.
    expect(refusalOf("/upgrade-flow")).toBe("pricing_or_billing");
    expect(refusalOf("/billing-v2/step-one")).toBe("pricing_or_billing");
    expect(refusalOf("/app/subscription-settings")).toBe("pricing_or_billing");
  });

  test("does not refuse the activation funnel that sits under an auth prefix", () => {
    // `auth` is a routing prefix, not a risk. Denying it would take the signup funnel §1
    // is built around with it.
    expect(verdictFor("/auth/signup").proposable).toBe(true);
    expect(verdictFor("/signup").proposable).toBe(true);
    expect(verdictFor("/register").proposable).toBe(true);
    expect(verdictFor("/onboarding/step-2").proposable).toBe(true);
    expect(verdictFor("/welcome").proposable).toBe(true);
  });

  test("does not refuse an ordinary product surface", () => {
    expect(verdictFor("/").proposable).toBe(true);
    expect(verdictFor("/dashboard").proposable).toBe(true);
    expect(verdictFor("/projects/:id/settings").proposable).toBe(true);
    expect(verdictFor("/search").proposable).toBe(true);
  });

  test("over-refuses rather than under-refuses, and the customer list is the way back", () => {
    // Stated behaviour, not an accident: a page merely discussing pricing is refused,
    // because the cost of a wrong refusal is a fix and the cost of a wrong approval is a
    // legal incident. See .ai/decisions/0013-expected-value-ranking.md D-4.
    expect(refusalOf("/blog/pricing-strategy")).toBe("pricing_or_billing");

    expect(
      isProposableSurface("/blog/pricing-strategy", {
        confirmedChangeable: new Set(["/blog/pricing-strategy"]),
      }).proposable,
    ).toBe(true);
  });

  test("the customer list is matched exactly, never by prefix", () => {
    const scope = { confirmedChangeable: new Set(["/billing"]) };

    expect(isProposableSurface("/billing", scope).proposable).toBe(true);
    expect(isProposableSurface("/billing/invoices", scope).proposable).toBe(false);
  });

  test("refuses whatever the casing", () => {
    expect(refusalOf("/Checkout")).toBe("pricing_or_billing");
    expect(refusalOf("/LOGIN")).toBe("auth");
  });

  test("an empty surface is proposable, because there is nothing forbidden in it", () => {
    // The shape is refused earlier, at the fix spec's own normalisation check. This gate
    // answers one question only, and answering a second one here would hide the first.
    expect(verdictFor("").proposable).toBe(true);
  });
});
