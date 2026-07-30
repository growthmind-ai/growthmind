// Internal-domain inference (O-003 F-2) and the domain extractor every other
// predicate depends on.
//
// FAIL DIRECTION (F-2): toward inferring NOTHING. A missing org-creator
// email, a free-mail creator email, a malformed address, or a domain with no
// dot all yield `null` — never a guess. Same asymmetry as F-1: a wrong
// inference silently erases the customer's whole user base.
//
// TYPED STUB (O-003 scaffold): signatures are final; bodies throw.

/**
 * The domain part of an email address, lowercased — `"a@Acme.com"` →
 * `"acme.com"`. Returns `null` for anything that is not exactly one `@` with
 * a dotted, non-empty domain on the right.
 *
 * NEVER returns the address itself (product-decisions §5): the address does
 * not cross this boundary, only the domain does.
 */
export function emailDomainOf(_email: string | null): string | null {
  throw new Error("TYPED STUB (O-003 scaffold): emailDomainOf");
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
export function inferInternalDomain(_creatorEmail: string | null): string | null {
  throw new Error("TYPED STUB (O-003 scaffold): inferInternalDomain");
}
