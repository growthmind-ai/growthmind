// ADD §9 items 8–12 — internal-domain inference and its free-mail guard
// (O-003 F-1 / F-2, edge taxonomy D10).
//
// F-1's fail direction: toward free mail ⇒ infer NOTHING. Inferring
// `gmail.com` as a company's internal domain would set aside essentially the
// entire real user base — the single most destructive outcome available here,
// and unrecoverable in perception, because the product simply appears to have
// no users. Every near-miss below exists so a suffix/substring rule (which
// fires on a superset of its target) fails loudly instead of shipping.
//
// Fixture discipline: lane seed prefix `s0-` on every address.
import { describe, expect, test } from "bun:test";

import { FREE_MAIL_DOMAINS, isFreeMailDomain } from "../../src/exclusions/free-mail";
import { emailDomainOf, inferInternalDomain } from "../../src/exclusions/internal-domain";

describe("inferInternalDomain", () => {
  // Item 8
  test("infers the company domain from a company creator email", () => {
    expect(inferInternalDomain("s0-founder@acme.com")).toBe("acme.com");
    expect(inferInternalDomain("s0-ops@acme.co.uk")).toBe("acme.co.uk");
    // Case and surrounding whitespace are the customer's, not a new domain.
    expect(inferInternalDomain("S0-Founder@ACME.com")).toBe("acme.com");
  });

  // Item 9 — the sprint-critical case.
  test("infers NOTHING from a free-mail creator email", () => {
    for (const address of [
      "s0-founder@gmail.com",
      "s0-founder@googlemail.com",
      "s0-founder@outlook.com",
      "s0-founder@hotmail.co.uk",
      "s0-founder@yahoo.com",
      "s0-founder@icloud.com",
      "s0-founder@proton.me",
      "s0-founder@mail.ru",
      "s0-founder@qq.com",
    ]) {
      expect(inferInternalDomain(address)).toBeNull();
    }
  });

  // Item 10 — F-1 near-miss fixtures (REQUIRED).
  test("free-mail near-misses: gmail.acme.com, outlook.acme.io, sendmail.dev are company domains", () => {
    // A company running its own mail on a subdomain named after a free
    // provider is a real, ordinary customer. A suffix or substring rule would
    // silently erase them.
    expect(isFreeMailDomain("gmail.acme.com")).toBe(false);
    expect(isFreeMailDomain("outlook.acme.io")).toBe(false);
    expect(isFreeMailDomain("sendmail.dev")).toBe(false);
    expect(isFreeMailDomain("notgmail.com")).toBe(false);
    expect(isFreeMailDomain("gmail.com.co")).toBe(false);
    expect(isFreeMailDomain("mail.acme.com")).toBe(false);

    // Controls: the real free-mail domains still match, exactly.
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("outlook.com")).toBe(true);

    expect(inferInternalDomain("s0-founder@gmail.acme.com")).toBe("gmail.acme.com");
    expect(inferInternalDomain("s0-ops@outlook.acme.io")).toBe("outlook.acme.io");
    expect(inferInternalDomain("s0-hello@sendmail.dev")).toBe("sendmail.dev");
  });

  // Item 11 — F-1 / F-2.
  test("plus-addressed free mail still infers nothing; empty and malformed addresses infer nothing", () => {
    // Plus-addressing changes the local part only — the domain is unchanged,
    // so a naive whole-address check would miss it and infer `gmail.com`.
    expect(inferInternalDomain("s0-founder+growthmind@gmail.com")).toBeNull();
    expect(inferInternalDomain("s0-founder+tag@googlemail.com")).toBeNull();
    // ...and the same shape on a company domain still infers.
    expect(inferInternalDomain("s0-founder+tag@acme.com")).toBe("acme.com");

    // F-2: a missing, empty, or malformed creator email must never produce a
    // guess. The org with no resolvable owner is a real state, not an error.
    expect(inferInternalDomain(null)).toBeNull();
    expect(inferInternalDomain("")).toBeNull();
    expect(inferInternalDomain("   ")).toBeNull();
    expect(inferInternalDomain("notanemail")).toBeNull();
    expect(inferInternalDomain("s0-founder@")).toBeNull();
    expect(inferInternalDomain("@acme.com")).toBeNull();
    // Multiple `@` — ambiguous, so infer nothing rather than pick one.
    expect(inferInternalDomain("s0-founder@acme.com@evil.example")).toBeNull();
    // A domain with no dot cannot be a company's public mail domain.
    expect(inferInternalDomain("s0-founder@localhost")).toBeNull();
  });
});

describe("emailDomainOf", () => {
  // Item 12 — product-decisions §5: the address never crosses this boundary.
  test("returns the domain and never the address", () => {
    const address = "s0-Founder@Acme.COM";

    const domain = emailDomainOf(address);

    expect(domain).toBe("acme.com");
    expect(domain).not.toContain("@");
    expect(domain?.toLowerCase()).not.toContain("s0-founder");

    // Same refusals as F-2: no dotted domain on the right ⇒ null.
    expect(emailDomainOf(null)).toBeNull();
    expect(emailDomainOf("")).toBeNull();
    expect(emailDomainOf("notanemail")).toBeNull();
    expect(emailDomainOf("s0-founder@")).toBeNull();
    expect(emailDomainOf("s0-founder@localhost")).toBeNull();
    expect(emailDomainOf("s0-founder@acme.com@evil.example")).toBeNull();
  });

  test("a free-mail address still yields its domain — the guard lives in inferInternalDomain", () => {
    // emailDomainOf is the extractor every predicate depends on; it does not
    // apply policy. Conflating the two would make the free-mail guard
    // unreachable for any other caller.
    expect(emailDomainOf("s0-founder@gmail.com")).toBe("gmail.com");
    expect(inferInternalDomain("s0-founder@gmail.com")).toBeNull();
  });
});

describe("FREE_MAIL_DOMAINS", () => {
  test("is stored lowercased with no leading dot, so matching can be exact", () => {
    // A `.gmail.com`-style entry would only ever be usable by a suffix rule —
    // the exact shape F-1 forbids.
    for (const domain of FREE_MAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain.startsWith(".")).toBe(false);
      expect(domain).toContain(".");
    }
    expect(FREE_MAIL_DOMAINS.has("gmail.com")).toBe(true);
  });
});
