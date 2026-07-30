// SSRF containment (O-003 security audit C-1/C-2).
//
// The host is customer-supplied and reaches fetch() from a server the customer
// does not own; the pagination cursor is chosen by the upstream and is followed
// with the customer's personal API key attached. These are the two outbound
// controls, so each rejection reason gets a named case rather than a smoke test.
import { describe, expect, test } from "bun:test";

import { checkHost, isBlockedHostname, isSameOriginAsHost } from "../../src/posthog/host-guard";

const REAL_HOST = "https://eu.posthog.com";

describe("checkHost accepts only a plain https host", () => {
  test("accepts a real PostHog host and returns its origin", () => {
    expect(checkHost(REAL_HOST)).toEqual({ ok: true, origin: "https://eu.posthog.com" });
  });

  test("accepts a host with a trailing slash, normalising the origin", () => {
    expect(checkHost("https://eu.posthog.com/")).toEqual({
      ok: true,
      origin: "https://eu.posthog.com",
    });
  });

  test("rejects plaintext http — the key would cross the wire in clear", () => {
    expect(checkHost("http://eu.posthog.com")).toEqual({ ok: false, reason: "scheme_not_https" });
  });

  test("rejects a non-url", () => {
    expect(checkHost("not a url").ok).toBe(false);
  });

  test("rejects embedded credentials, which can smuggle a different authority", () => {
    expect(checkHost("https://user:pass@eu.posthog.com")).toEqual({
      ok: false,
      reason: "credentials_in_url",
    });
  });
});

describe("checkHost blocks addresses a server must never be aimed at", () => {
  // The headline case: AWS/GCP/Azure instance metadata. Reaching this from a
  // tenant-supplied host is credential theft against the whole deployment.
  test.each([
    ["cloud instance metadata", "https://169.254.169.254"],
    ["loopback literal", "https://127.0.0.1"],
    ["loopback name", "https://localhost"],
    ["private 10/8", "https://10.0.0.1"],
    ["private 172.16/12", "https://172.16.0.5"],
    ["private 192.168/16", "https://192.168.1.1"],
    ["CGNAT 100.64/10", "https://100.64.0.1"],
    ["GCP metadata name", "https://metadata.google.internal"],
    ["cluster-internal suffix", "https://postgres.internal"],
    ["IPv6 loopback", "https://[::1]"],
    ["IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]"],
    ["IPv6 unique-local", "https://[fd00::1]"],
    // H-1: a fully-qualified hostname's trailing root dot. Confirmed live
    // before the fix — each of these resolved ALLOW even though the bare
    // spelling (no trailing dot) was already blocked.
    ["loopback name with a trailing FQDN dot", "https://localhost./api"],
    ["GCP metadata name with a trailing FQDN dot", "https://metadata.google.internal./"],
    ["cluster-internal suffix with a trailing FQDN dot", "https://foo.internal./"],
    ["loopback alias with a trailing FQDN dot", "https://localhost.localdomain./"],
    // L-4: IPv4-compatible IPv6 (distinct from IPv4-mapped above — no `ffff`
    // group), both spellings.
    ["IPv4-compatible IPv6 loopback, dotted", "https://[::127.0.0.1]"],
    ["IPv4-compatible IPv6 loopback, hex", "https://[::7f00:1]"],
    // L-4: the four newly-added reserved IPv4 ranges.
    ["benchmarking 198.18/15", "https://198.18.0.1"],
    ["benchmarking 198.19/15", "https://198.19.255.1"],
    ["IETF protocol assignments 192.0.0/24", "https://192.0.0.1"],
    ["multicast 224/4", "https://224.0.0.1"],
    ["multicast 239/4 upper bound", "https://239.255.255.255"],
    ["reserved 240/4", "https://240.0.0.1"],
  ])("rejects %s", (_label, host) => {
    expect(checkHost(host)).toEqual({ ok: false, reason: "hostname_blocked" });
  });

  test("does not over-block a public address that merely looks adjacent", () => {
    // 172.32.x is OUTSIDE 172.16/12, and 100.128.x is outside 100.64/10 —
    // a near-miss fixture per predicate, so the deny-list cannot quietly widen
    // into refusing real customer hosts.
    expect(checkHost("https://172.32.0.1").ok).toBe(true);
    expect(checkHost("https://100.128.0.1").ok).toBe(true);
    expect(isBlockedHostname("11.0.0.1")).toBe(false);
    expect(isBlockedHostname("eu.posthog.com")).toBe(false);

    // L-4 near-misses: one below each new range's floor, one above its
    // ceiling, so the four new predicates cannot quietly widen either.
    expect(isBlockedHostname("198.17.255.255")).toBe(false);
    expect(isBlockedHostname("198.20.0.0")).toBe(false);
    expect(isBlockedHostname("192.0.1.1")).toBe(false);
    expect(isBlockedHostname("223.255.255.255")).toBe(false);
    // IPv4-compatible IPv6 pointed at an ordinary public address must still
    // resolve, so the new pattern cannot be mistaken for "block all ::-forms".
    expect(isBlockedHostname("[::0808:0808]")).toBe(false);

    // H-1 near-misses: a normal public hostname must not be blocked merely
    // for carrying a trailing dot, and a hostname that only CONTAINS
    // "internal" as a substring (not a `.internal` suffix) must not be
    // over-blocked either.
    expect(isBlockedHostname("eu.posthog.com.")).toBe(false);
    expect(isBlockedHostname("internal-tools.example.com")).toBe(false);
  });
});

describe("isSameOriginAsHost bounds where a credential-bearing request may go", () => {
  test("allows the next page on the configured origin", () => {
    expect(isSameOriginAsHost(`${REAL_HOST}/api/projects/1/events?after=x`, REAL_HOST)).toBe(true);
  });

  test("refuses an absolute cursor pointing at another origin", () => {
    // The exfiltration primitive: the upstream answers
    // {"results":[],"next":"https://attacker.tld/x"} and the next fetch would
    // carry `authorization: Bearer <customer personal API key>`.
    expect(isSameOriginAsHost("https://attacker.tld/x", REAL_HOST)).toBe(false);
  });

  test("refuses a cursor that downgrades the scheme on the same hostname", () => {
    expect(isSameOriginAsHost("http://eu.posthog.com/api/x", REAL_HOST)).toBe(false);
  });

  test("refuses a cursor on a different port of the same hostname", () => {
    expect(isSameOriginAsHost("https://eu.posthog.com:8443/api/x", REAL_HOST)).toBe(false);
  });

  test("refuses a cursor carrying embedded credentials", () => {
    expect(isSameOriginAsHost("https://u:p@eu.posthog.com/api/x", REAL_HOST)).toBe(false);
  });

  test("refuses everything when the configured host is itself invalid", () => {
    expect(isSameOriginAsHost("https://169.254.169.254/x", "https://169.254.169.254")).toBe(false);
  });
});
