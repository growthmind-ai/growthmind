// Slack's own three, ampersand first so an escape is never escaped twice. Caller free text
// reaches every mrkdwn body and the fallback text alike: `<https://x|Reset your password>`
// renders as a live link and `<!channel>` as a broadcast, in Growthmind's voice, with no human
// in the loop.
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Slack's limits apply to what arrives on the wire, and the escape only ever grows a string.
export function mrkdwnLength(text: string): number {
  return escapeMrkdwn(text).length;
}

// The longest prefix of `text` whose escaped form still fits `budget`.
export function mrkdwnPrefixLength(text: string, budget: number): number {
  let used = 0;

  for (let index = 0; index < text.length; index += 1) {
    used += mrkdwnLength(text.charAt(index));
    if (used > budget) return index;
  }

  return text.length;
}
