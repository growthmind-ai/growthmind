import { isBlockedHostname } from "../http/origin";

export type HostRejection =
  "not_a_url" | "scheme_not_https" | "hostname_blocked" | "credentials_in_url";

export type HostCheck =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: HostRejection };

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
