// One pass, so a value carrying a brace token of its own is never re-expanded, and a token with
// no value is left as written rather than becoming "undefined" in front of a customer.
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => values[key] ?? token);
}
