// SSRF containment for the one outbound surface this adapter has (security audit
// C-1/C-2).
//
// The host is customer-supplied and reaches `fetch` from a server the customer does
// not own. Without these checks a tenant can aim our worker at `http://169.254.169.254`
// (cloud instance metadata), at `localhost`, or at anything inside the provider's vpc,
// and `validate` runs before any row is written, so merely *attempting* a connection
// fires the request. Because the adapter deliberately keeps `unreachable` /
// `invalid_credentials` / `project_not_found` distinguishable for the customer's
// benefit, the response doubles as a port-scanning oracle.
//
// The pagination cursor is the sharper half. PostHog returns `next` as an absolute url,
// and the client follows it with the customer's personal API key in an `authorization`
// header. An upstream that answers `{"results":[],"next":"https://attacker.tld/x"}`
// therefore steals the key outright, and any allow-list applied only to the configured
// host is bypassed by construction. So the cursor is origin-checked against the
// configured host on every hop.

/**
 * Loopback, link-local (incl. cloud metadata), private, and cgnat ranges, plus
 * benchmarking, ietf protocol assignments, multicast,
 * and the reserved "future use" class (240/4, which subsumes 255/8's broadcast. Kept as
 * its own named case below anyway so its test fixture stays self-explanatory). None of
 * these should ever be a live customer PostHog host.
 */
const BLOCKED_IPV4 = [
  { name: "loopback", test: (o: number[]) => o[0] === 127 },
  { name: "private", test: (o: number[]) => o[0] === 10 },
  { name: "private", test: (o: number[]) => o[0] === 172 && o[1] >= 16 && o[1] <= 31 },
  { name: "private", test: (o: number[]) => o[0] === 192 && o[1] === 168 },
  // 169.254.0.0/16, AWS/gcp/Azure instance metadata lives at 169.254.169.254.
  { name: "link-local", test: (o: number[]) => o[0] === 169 && o[1] === 254 },
  { name: "cgnat", test: (o: number[]) => o[0] === 100 && o[1] >= 64 && o[1] <= 127 },
  { name: "this-network", test: (o: number[]) => o[0] === 0 },
  { name: "broadcast", test: (o: number[]) => o[0] === 255 },
  // L-4: 198.18.0.0/15, rfc 2544 benchmarking. A near-miss neighbour of the cgnat range
  // above and a real-world ssrf probe target.
  { name: "benchmarking", test: (o: number[]) => o[0] === 198 && (o[1] === 18 || o[1] === 19) },
  // L-4: 192.0.0.0/24, ietf protocol assignments (rfc 6890). Deliberately narrow (a
  // /24, not the whole 192.0.0.0/8) so it does not shadow ordinary public 192.0.x.x
  // addresses one octet away.
  {
    name: "ietf-protocol-assignments",
    test: (o: number[]) => o[0] === 192 && o[1] === 0 && o[2] === 0,
  },
  // L-4: 224.0.0.0/4, multicast, never a unicast host to poll.
  { name: "multicast", test: (o: number[]) => o[0] >= 224 && o[0] <= 239 },
  // L-4: 240.0.0.0/4, reserved for future use (includes 255.255.255.255, already caught
  // above by "broadcast").
  { name: "reserved", test: (o: number[]) => o[0] >= 240 },
] as const;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

export type HostRejection =
  "not_a_url" | "scheme_not_https" | "hostname_blocked" | "credentials_in_url";

export type HostCheck =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: HostRejection };

function ipv4Octets(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

/**
 * True for a hostname that must never be fetched from a server: loopback, link-local,
 * private, cgnat, or a well-known metadata name.
 *
 * Literal-address only. A hostname that resolves to a private address (DNS rebinding,
 * or an attacker-controlled A record) is not caught here. Closing that requires
 * resolving and pinning the address at connect time and again per request. Named as a
 * known limit rather than implied to be covered; the deployment-level mitigation is an
 * egress policy on the worker.
 *
 * Fail direction: closed. Every normalisation below (case, brackets, a trailing
 * fqdn dot) exists to keep an attacker from spelling a blocked name in a form the
 * deny-list's exact-match and suffix checks would otherwise miss. A hostname is
 * `hostname_blocked` whenever any normalised spelling of it matches, never "only the
 * first spelling we thought of."
 */
export function isBlockedHostname(hostname: string): boolean {
  // : a fully-qualified hostname carries a trailing root dot (`localhost.`) that DNS
  // treats as identical to the bare name, but that neither the exact-match
  // `BLOCKED_HOSTNAMES` set nor the `.localhost` / `.internal` suffix checks below
  // would match without stripping it first, `localhost.` and
  // `metadata.google.internal.` both resolved as allow before this line existed. Only
  // one trailing dot is stripped: more than one is not a valid fqdn spelling and is
  // left for the URL parser (or a downstream fetch) to reject on its own terms.
  const lower = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".localhost") || lower.endsWith(".internal")) return true;

  // IPv6 loopback / unspecified / unique-local / link-local.
  if (lower === "::1" || lower === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (lower.startsWith("fe80:")) return true;
  // IPv4-mapped IPv6. Two spellings reach here: the dotted form a human types
  // (`::ffff:127.0.0.1`) and the hex form the whatwg URL parser normalises it to
  // (`::ffff:7f00:1`). Checking only the dotted form would let the hex spelling of
  // loopback straight through.
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mappedDotted?.[1]) return isBlockedHostname(mappedDotted[1]);

  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mappedHex?.[1] && mappedHex[2]) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isBlockedHostname(
      [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join("."),
    );
  }

  // L-4: IPv4-compatible IPv6 (the deprecated `::a.b.c.d` form, rfc 4291. Distinct from
  // IPv4-mapped above, which always carries a literal `ffff` group). Same two spellings
  // as the mapped case: the dotted form and the hex form a parser may
  // normalise it to. Checked after the `ffff`-prefixed mapped patterns
  // above so the two forms can never be confused for one another.
  const compatDotted = /^::(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (compatDotted?.[1]) return isBlockedHostname(compatDotted[1]);

  const compatHex = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (compatHex?.[1] && compatHex[2]) {
    const high = Number.parseInt(compatHex[1], 16);
    const low = Number.parseInt(compatHex[2], 16);
    return isBlockedHostname(
      [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join("."),
    );
  }

  const octets = ipv4Octets(lower);
  if (octets) return BLOCKED_IPV4.some((range) => range.test(octets));

  return false;
}

/**
 * Validates a customer-supplied host and returns its canonical origin.
 *
 * HTTPS only: a plaintext hop would expose the personal API key to anyone on the path,
 * and it is the scheme an attacker picks when they want a network-position downgrade.
 */
export function checkHost(host: string): HostCheck {
  let url: URL;
  try {
    url = new URL(host.trim());
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "scheme_not_https" };
  // `https://user:pass@host`, credentials in the URL would be sent onward and can
  // smuggle a different authority past a naive host comparison.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials_in_url" };
  }
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: "hostname_blocked" };

  return { ok: true, origin: url.origin };
}

/**
 * True when `candidate` is a url we may follow while carrying the customer's
 * credential. I.e. it is same-origin with the configured host and that origin still
 * passes `checkHost`.
 *
 * Used for the pagination cursor. A mismatch is treated as a terminal failure by the
 * caller, never as "end of pages": silently stopping would let a hostile upstream
 * truncate a customer's data instead of exfiltrating it, which is a quieter bug, not a
 * safer one.
 */
export function isSameOriginAsHost(candidate: string, host: string): boolean {
  const configured = checkHost(host);
  if (!configured.ok) return false;

  let candidateUrl: URL;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }

  if (candidateUrl.username !== "" || candidateUrl.password !== "") return false;
  return candidateUrl.origin === configured.origin;
}
