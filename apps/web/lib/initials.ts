// Falls back through name → email → "?" so the avatar always has something to render. A
// blank circle beside a signed-in person's own email reads as a broken image, not as a person.
export function initialsOf(name: string | null, email: string | null): string {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/u)
    .filter((part) => /\p{L}|\p{N}/u.test(part));

  if (parts.length > 0) {
    const first = parts[0]?.match(/\p{L}|\p{N}/u)?.[0] ?? "";
    const last = parts.length > 1 ? (parts.at(-1)?.match(/\p{L}|\p{N}/u)?.[0] ?? "") : "";
    return (first + last).toUpperCase();
  }

  return (email ?? "").match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "?";
}
