export const NON_ADDRESS_SENTINELS: readonly string[] = Object.freeze(["null", "undefined"]);

export const NON_ADDRESS_VALUES: readonly string[] = Object.freeze(["", ...NON_ADDRESS_SENTINELS]);

const TRIMMED_WHITESPACE_CODES: readonly number[] = Object.freeze([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
]);

// Postgres `btrim(x)` removes U+0020 and nothing else; this is its second argument.
export const TRIMMED_WHITESPACE: string = String.fromCodePoint(...TRIMMED_WHITESPACE_CODES);

export function isDeliveryAddress(channelId: string | null | undefined): channelId is string {
  if (typeof channelId !== "string") {
    return false;
  }

  const trimmed = channelId.trim().toLowerCase();

  return trimmed.length > 0 && !NON_ADDRESS_SENTINELS.includes(trimmed);
}
