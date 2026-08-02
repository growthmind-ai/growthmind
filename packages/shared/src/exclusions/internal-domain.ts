import { isFreeMailDomain } from "./free-mail";

export function emailDomainOf(email: string | null): string | null {
  if (email === null) return null;

  const trimmed = email.trim();

  if (trimmed.length === 0) return null;
  if (/\s/.test(trimmed)) return null;

  const parts = trimmed.split("@");

  if (parts.length !== 2) return null;

  const [localPart, domainPart] = parts as [string, string];
  if (localPart.length === 0) return null;

  const domain = domainPart.toLowerCase();
  if (domain.length === 0) return null;

  if (!domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".")) return null;
  if (domain.includes("..")) return null;

  return domain;
}

export function inferInternalDomain(creatorEmail: string | null): string | null {
  const domain = emailDomainOf(creatorEmail);
  if (domain === null) return null;

  if (isFreeMailDomain(domain)) return null;

  return domain;
}
