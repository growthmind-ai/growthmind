// Free-mail guard on internal-domain inference (O-003 F-1).
//
// FAIL DIRECTION: toward free-mail ⇒ infer nothing. Inferring `gmail.com` as
// a company's internal domain would exclude essentially the entire real user
// base — the single most destructive outcome available here, and
// unrecoverable in perception, because the product simply appears to have no
// users. When in doubt, treat a domain as free mail and infer nothing.
//
// Matching is EXACT, on the whole domain. `gmail.acme.com` is a company
// domain, not free mail — a suffix or substring rule would fire on a superset
// of its target, which is the D10 conflation this sprint exists to prevent.

/**
 * The v1 free-mail domain list. Real, final data — tests assert against it.
 * Consumed through `CURRENT_EXCLUSION_RULE_SET.freeMailDomains`; kept here so
 * a version bump is a new set, never an edit to a live one (D12).
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "mail.ru",
  "yandex.ru",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.io",
  "duck.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "daum.net",
  "seznam.cz",
  "orange.fr",
  "free.fr",
  "wanadoo.fr",
  "laposte.net",
  "libero.it",
  "virgilio.it",
  "t-online.de",
  "bluewin.ch",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "btinternet.com",
  "sky.com",
  "ntlworld.com",
  "shaw.ca",
  "rogers.com",
  "bigpond.com",
  "optusnet.com.au",
  "xtra.co.nz",
  "rediffmail.com",
  "sina.com",
  "hushmail.com",
  "inbox.com",
  "mailinator.com",
  "yopmail.com",
  "guerrillamail.com",
  "10minutemail.com",
  "trashmail.com",
  "sharklasers.com",
  "temp-mail.org",
]);

/**
 * TYPED STUB (O-003 scaffold). Exact whole-domain membership test against
 * `FREE_MAIL_DOMAINS`, case-insensitive on an already-lowercased domain.
 * Never a suffix match.
 */
export function isFreeMailDomain(_domain: string): boolean {
  throw new Error("TYPED STUB (O-003 scaffold): isFreeMailDomain");
}
