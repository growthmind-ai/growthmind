export interface InlineSpan {
  readonly text: string;
  readonly strong: boolean;
}

const MRKDWN_LINK = /<([^|>]+)\|([^>]+)>/g;
const BOLD = /\*([^*\n]+)\*/g;

// The stored blocks carry Slack's own markup. Emphasis is reproduced because Slack showed it;
// a link is reduced to its label because none of Slack's affordances are drawn live here —
// the same reason the message's buttons are shown and not wired.
export function inlineSpans(text: string): readonly InlineSpan[] {
  const flattened = text.replaceAll(MRKDWN_LINK, "$2");

  const spans: InlineSpan[] = [];
  let at = 0;

  for (const match of flattened.matchAll(BOLD)) {
    const start = match.index;
    if (start > at) {
      spans.push({ text: flattened.slice(at, start), strong: false });
    }
    spans.push({ text: match[1] ?? "", strong: true });
    at = start + match[0].length;
  }

  if (at < flattened.length) {
    spans.push({ text: flattened.slice(at), strong: false });
  }

  return spans.length > 0 ? spans : [{ text: flattened, strong: false }];
}
