import { FORBIDDEN_REASONS, type ForbiddenReason } from "@growthmind/shared";

// Matched per path segment, by substring, so `upgrade-flow` and `billing-v2` are caught.
// `auth` is deliberately absent: it is a routing prefix, not a risk, and denying it would
// take `/auth/signup` — the activation funnel §1 is built around — with it. The mechanics
// underneath it are what carry the risk, and they are named individually.
const FORBIDDEN_SEGMENTS: Readonly<Record<ForbiddenReason, readonly string[]>> = {
  pricing_or_billing: [
    "pricing",
    "price",
    "billing",
    "payment",
    "checkout",
    "invoice",
    "subscription",
    "subscribe",
    "upgrade",
    "downgrade",
    "paywall",
    "purchase",
    "refund",
    "coupon",
    "discount",
    "stripe",
    "paddle",
  ],
  auth: [
    "login",
    "signin",
    "logout",
    "signout",
    "password",
    "forgot",
    "oauth",
    "sso",
    "saml",
    "mfa",
    "2fa",
    "otp",
    "credential",
  ],
  consent_or_terms: [
    "consent",
    "cookie",
    "privacy",
    "terms",
    "legal",
    "gdpr",
    "ccpa",
    "dpa",
    "eula",
    "licence",
    "license",
  ],
};

export type ProposalVerdict =
  | { readonly proposable: true }
  | {
      readonly proposable: false;
      readonly reason: ForbiddenReason;
      readonly matched: string;
    };

export type ProposalScope = {
  // Surfaces the customer has confirmed are theirs to change. The escape hatch for an
  // over-refusal, which is the failure this gate is tuned to produce.
  readonly confirmedChangeable: ReadonlySet<string>;
};

export const EMPTY_PROPOSAL_SCOPE: ProposalScope = { confirmedChangeable: new Set<string>() };

function segmentsOf(surface: string): readonly string[] {
  return surface
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function isProposableSurface(surface: string, scope: ProposalScope): ProposalVerdict {
  if (scope.confirmedChangeable.has(surface)) {
    return { proposable: true };
  }

  for (const segment of segmentsOf(surface)) {
    for (const reason of FORBIDDEN_REASONS) {
      const matched = FORBIDDEN_SEGMENTS[reason].find((marker) => segment.includes(marker));
      if (matched !== undefined) {
        return { proposable: false, reason, matched };
      }
    }
  }

  return { proposable: true };
}
