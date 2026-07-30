// Internal-domain inference (O-003 F-2) and the domain extractor every other
// predicate depends on.
//
// FAIL DIRECTION (F-2): toward inferring NOTHING. A missing org-creator
// email, a free-mail creator email, a malformed address, or a domain with no
// dot all yield `null` — never a guess. Same asymmetry as F-1: a wrong
// inference silently erases the customer's whole user base.
//
// Implemented in Wave 1 against the scaffold's final signatures.
import { isFreeMailDomain } from "./free-mail";

/**
 * The domain part of an email address, lowercased — `"a@Acme.com"` →
 * `"acme.com"`. Returns `null` for anything that is not exactly one `@` with
 * a dotted, non-empty domain on the right.
 *
 * NEVER returns the address itself (product-decisions §5): the address does
 * not cross this boundary, only the domain does.
 */
export function emailDomainOf(email: string | null): string | null {
  if (email === null) return null;

  const trimmed = email.trim();
  // FAIL DIRECTION (F-2): toward null. Every refusal below is a shape we
  // cannot read confidently, and a guess costs the customer their user base.
  if (trimmed.length === 0) return null;
  if (/\s/.test(trimmed)) return null;

  const parts = trimmed.split("@");
  // Exactly one `@`. `a@acme.com@evil.example` is ambiguous, so it is refused
  // rather than resolved by picking a side.
  if (parts.length !== 2) return null;

  const [localPart, domainPart] = parts as [string, string];
  if (localPart.length === 0) return null;

  const domain = domainPart.toLowerCase();
  if (domain.length === 0) return null;
  // A domain with no dot cannot be a company's public mail domain, and a
  // leading or trailing dot is not a domain at all.
  if (!domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".")) return null;
  if (domain.includes("..")) return null;

  return domain;
}

/**
 * Infers a company's internal domain from the organization creator's email.
 * `emailDomainOf` first, then the F-1 free-mail guard: a free-mail domain
 * infers nothing.
 *
 * Matching against this value later is EXACT (F-3) — no subdomain rule —
 * because `acme.com` matching `acme.com.attacker.net` is exactly the superset
 * failure this sprint exists to prevent.
 */
export function inferInternalDomain(creatorEmail: string | null): string | null {
  const domain = emailDomainOf(creatorEmail);
  if (domain === null) return null;

  // FAIL DIRECTION (F-1): toward inferring NOTHING. Plus-addressing changes
  // only the local part, so the guard has to sit on the domain — a check
  // against the whole address would miss `founder+tag@gmail.com` and infer
  // `gmail.com` as the company, setting aside every real user there is.
  if (isFreeMailDomain(domain)) return null;

  return domain;
}
