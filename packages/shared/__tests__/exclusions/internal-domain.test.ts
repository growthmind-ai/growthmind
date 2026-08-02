import { describe, expect, test } from "bun:test";

import { FREE_MAIL_DOMAINS, isFreeMailDomain } from "../../src/exclusions/free-mail";
import { emailDomainOf, inferInternalDomain } from "../../src/exclusions/internal-domain";

describe("inferInternalDomain", () => {
  test("infers the company domain from a company creator email", () => {
    expect(inferInternalDomain("s0-founder@acme.com")).toBe("acme.com");
    expect(inferInternalDomain("s0-ops@acme.co.uk")).toBe("acme.co.uk");

    expect(inferInternalDomain("S0-Founder@ACME.com")).toBe("acme.com");
  });

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

  test("free-mail near-misses: gmail.acme.com, outlook.acme.io, sendmail.dev are company domains", () => {
    expect(isFreeMailDomain("gmail.acme.com")).toBe(false);
    expect(isFreeMailDomain("outlook.acme.io")).toBe(false);
    expect(isFreeMailDomain("sendmail.dev")).toBe(false);
    expect(isFreeMailDomain("notgmail.com")).toBe(false);
    expect(isFreeMailDomain("gmail.com.co")).toBe(false);
    expect(isFreeMailDomain("mail.acme.com")).toBe(false);

    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("outlook.com")).toBe(true);

    expect(inferInternalDomain("s0-founder@gmail.acme.com")).toBe("gmail.acme.com");
    expect(inferInternalDomain("s0-ops@outlook.acme.io")).toBe("outlook.acme.io");
    expect(inferInternalDomain("s0-hello@sendmail.dev")).toBe("sendmail.dev");
  });

  test("plus-addressed free mail still infers nothing; empty and malformed addresses infer nothing", () => {
    expect(inferInternalDomain("s0-founder+growthmind@gmail.com")).toBeNull();
    expect(inferInternalDomain("s0-founder+tag@googlemail.com")).toBeNull();

    expect(inferInternalDomain("s0-founder+tag@acme.com")).toBe("acme.com");

    expect(inferInternalDomain(null)).toBeNull();
    expect(inferInternalDomain("")).toBeNull();
    expect(inferInternalDomain("   ")).toBeNull();
    expect(inferInternalDomain("notanemail")).toBeNull();
    expect(inferInternalDomain("s0-founder@")).toBeNull();
    expect(inferInternalDomain("@acme.com")).toBeNull();

    expect(inferInternalDomain("s0-founder@acme.com@evil.example")).toBeNull();

    expect(inferInternalDomain("s0-founder@localhost")).toBeNull();
  });
});

describe("emailDomainOf", () => {
  test("returns the domain and never the address", () => {
    const address = "s0-Founder@Acme.COM";

    const domain = emailDomainOf(address);

    expect(domain).toBe("acme.com");
    expect(domain).not.toContain("@");
    expect(domain?.toLowerCase()).not.toContain("s0-founder");

    expect(emailDomainOf(null)).toBeNull();
    expect(emailDomainOf("")).toBeNull();
    expect(emailDomainOf("notanemail")).toBeNull();
    expect(emailDomainOf("s0-founder@")).toBeNull();
    expect(emailDomainOf("s0-founder@localhost")).toBeNull();
    expect(emailDomainOf("s0-founder@acme.com@evil.example")).toBeNull();
  });

  test("a free-mail address still yields its domain — the guard lives in inferInternalDomain", () => {
    expect(emailDomainOf("s0-founder@gmail.com")).toBe("gmail.com");
    expect(inferInternalDomain("s0-founder@gmail.com")).toBeNull();
  });
});

describe("FREE_MAIL_DOMAINS", () => {
  test("is stored lowercased with no leading dot, so matching can be exact", () => {
    for (const domain of FREE_MAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain.startsWith(".")).toBe(false);
      expect(domain).toContain(".");
    }
    expect(FREE_MAIL_DOMAINS.has("gmail.com")).toBe(true);
  });
});
