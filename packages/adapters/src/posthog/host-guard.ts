const BLOCKED_IPV4 = [
  { name: "loopback", test: (o: number[]) => o[0] === 127 },
  { name: "private", test: (o: number[]) => o[0] === 10 },
  { name: "private", test: (o: number[]) => o[0] === 172 && o[1] >= 16 && o[1] <= 31 },
  { name: "private", test: (o: number[]) => o[0] === 192 && o[1] === 168 },

  { name: "link-local", test: (o: number[]) => o[0] === 169 && o[1] === 254 },
  { name: "cgnat", test: (o: number[]) => o[0] === 100 && o[1] >= 64 && o[1] <= 127 },
  { name: "this-network", test: (o: number[]) => o[0] === 0 },
  { name: "broadcast", test: (o: number[]) => o[0] === 255 },

  { name: "benchmarking", test: (o: number[]) => o[0] === 198 && (o[1] === 18 || o[1] === 19) },

  {
    name: "ietf-protocol-assignments",
    test: (o: number[]) => o[0] === 192 && o[1] === 0 && o[2] === 0,
  },

  { name: "multicast", test: (o: number[]) => o[0] >= 224 && o[0] <= 239 },

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

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".localhost") || lower.endsWith(".internal")) return true;

  if (lower === "::1" || lower === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (lower.startsWith("fe80:")) return true;

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

export function checkHost(host: string): HostCheck {
  let url: URL;
  try {
    url = new URL(host.trim());
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "scheme_not_https" };

  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials_in_url" };
  }
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: "hostname_blocked" };

  return { ok: true, origin: url.origin };
}

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
