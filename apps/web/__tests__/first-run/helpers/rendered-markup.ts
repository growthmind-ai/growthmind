// READING A RENDERED FIRST-RUN CARD THE WAY A FOUNDER DOES. Not a suite —
// `bun test` never picks this file up, and nothing in production imports it.
//
// ###########################################################################
// # WHY THIS IS PLUMBING AND NOT A PREDICATE.
// #
// # `renderToStaticMarkup` returns a string, and a substring search on that
// # string cannot tell "on the screen" from "in the DOM but folded away" —
// # which is the distinction two different suites now turn on: AD-6's card asks
// # whether the token form is behind a disclosure, and the channel picker's
// # empty state asks whether a picker rendered at all. So the markup is walked
// # once, and what comes back is what a person could read or a screen reader
// # announce: text outside every hidden subtree, plus the accessible name of
// # each control.
// #
// # Hidden means what the browser means by it — `display:none`, `hidden`,
// # `inert`, `aria-hidden="true"`, or a `<details>` nobody has opened. That set
// # is deliberately wider than any one widget: a collapsed Mantine `Collapse`
// # renders no children at all, a `<details>` renders them and hides them, and
// # this reader gives the same answer for both.
// #
// # IT HOLDS NO PREDICATE THAT DECIDES WHETHER A ROW PASSES, for the reason
// # `first-run-source.ts` gives one door down: a scanner separated from its
// # planted-offender and clean-fixture controls is a scanner nobody can see is
// # vacuous. Each suite keeps its own control row, asserting on its own
// # fixtures, that this reader can tell the two apart before it claims anything
// # about a real render.
// ###########################################################################

/** What one render of a first-run card looks like from the outside. */
export interface RenderedCard {
  /** Everything readable, joined — text nodes and accessible names. */
  readonly text: string;
  /** The accessible label of each visible button, link and summary. */
  readonly controls: readonly string[];
}

interface Frame {
  readonly hidden: boolean;
  readonly opaque: boolean;
  /** A closed `<details>`: its children are folded away, its `<summary>` is not. */
  readonly detailsClosed: boolean;
  /** The buffer collecting this element's label, when it is a control. */
  readonly control: string[] | null;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Elements whose contents are instructions to the browser, not words. */
const OPAQUE_ELEMENTS = new Set(["style", "script", "template"]);

/** What a founder can press. `summary` is here because a disclosure is one. */
const CONTROL_ELEMENTS = new Set(["a", "button", "summary"]);

const ARIA_HIDDEN = /(^|\s)aria-hidden\s*=\s*["']true["']/;
const HIDDEN_OR_INERT = /(^|\s)(hidden|inert)(\s|=|$)/;
const DISPLAY_NONE = /display\s*:\s*none/;
const OPEN_ATTRIBUTE = /(^|\s)open(\s|=|$)/;
const ACCESSIBLE_NAME = /(?:^|\s)(?:aria-label|alt|title)\s*=\s*"([^"]*)"/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    const codePoint = body.startsWith("#x")
      ? Number.parseInt(body.slice(2), 16)
      : body.startsWith("#")
        ? Number.parseInt(body.slice(1), 10)
        : Number.NaN;

    if (Number.isFinite(codePoint)) return String.fromCodePoint(codePoint);
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const isHidden = (attributes: string): boolean =>
  ARIA_HIDDEN.test(attributes) || HIDDEN_OR_INERT.test(attributes) || DISPLAY_NONE.test(attributes);

function accessibleNames(attributes: string): readonly string[] {
  const found: string[] = [];

  for (const match of attributes.matchAll(ACCESSIBLE_NAME)) {
    const value = match[1];
    if (value !== undefined && value.trim() !== "") found.push(value);
  }

  return found;
}

/** Walk the markup once, keeping only what reaches a person. */
export function readMarkup(html: string): RenderedCard {
  const words: string[] = [];
  const controls: string[] = [];
  const stack: Frame[] = [];
  const openControls: string[][] = [];
  let hiddenDepth = 0;
  let opaqueDepth = 0;

  const emit = (raw: string): void => {
    if (hiddenDepth > 0 || opaqueDepth > 0) return;
    if (stack[stack.length - 1]?.detailsClosed === true) return;

    const value = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (value === "") return;

    words.push(value);
    for (const buffer of openControls) buffer.push(value);
  };

  let index = 0;

  while (index < html.length) {
    const open = html.indexOf("<", index);

    if (open === -1) {
      emit(html.slice(index));
      break;
    }

    emit(html.slice(index, open));

    // A comment or a doctype — neither carries words.
    if (html.startsWith("<!", open)) {
      const close = html.indexOf(">", open);
      index = close === -1 ? html.length : close + 1;
      continue;
    }

    const closing = html[open + 1] === "/";
    let cursor = open + (closing ? 2 : 1);
    const nameStart = cursor;

    while (cursor < html.length && /[A-Za-z0-9:_-]/.test(html[cursor] ?? "")) cursor += 1;
    const name = html.slice(nameStart, cursor).toLowerCase();

    // Attribute values are scanned with quote awareness rather than by looking
    // for the next `>`: a `>` inside a quoted style or label would otherwise
    // end the tag early and spill markup into the text channel.
    let quote: string | null = null;
    const attributesStart = cursor;

    while (cursor < html.length) {
      const character = html[cursor] ?? "";

      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      cursor += 1;
    }

    const attributes = html.slice(attributesStart, cursor);
    index = cursor + 1;

    if (name === "") continue;

    if (closing) {
      const frame = stack.pop();
      if (frame === undefined) continue;

      if (frame.control !== null) {
        openControls.pop();
        const label = frame.control.join(" ").trim();
        if (label !== "") controls.push(label);
      }
      if (frame.hidden) hiddenDepth -= 1;
      if (frame.opaque) opaqueDepth -= 1;
      continue;
    }

    const parent = stack[stack.length - 1];
    const foldedByDetails = parent?.detailsClosed === true && name !== "summary";
    const hidden = isHidden(attributes) || foldedByDetails;
    const visible = !hidden && hiddenDepth === 0 && opaqueDepth === 0;

    if (attributes.trimEnd().endsWith("/") || VOID_ELEMENTS.has(name)) {
      if (visible) for (const label of accessibleNames(attributes)) emit(label);
      continue;
    }

    const control = visible && CONTROL_ELEMENTS.has(name) ? [] : null;

    stack.push({
      hidden,
      opaque: OPAQUE_ELEMENTS.has(name),
      detailsClosed: name === "details" && !OPEN_ATTRIBUTE.test(attributes),
      control,
    });
    if (hidden) hiddenDepth += 1;
    if (OPAQUE_ELEMENTS.has(name)) opaqueDepth += 1;
    if (control !== null) openControls.push(control);

    for (const label of accessibleNames(attributes)) emit(label);
  }

  return { text: words.join(" "), controls };
}
