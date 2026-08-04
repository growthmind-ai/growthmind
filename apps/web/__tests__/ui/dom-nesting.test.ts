import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// `Text` renders a `<p>` and `Title` an `<h1>`–`<h6>`. Putting a block element inside either
// is invalid HTML: React logs "<p> cannot contain a nested <div>" at request time and
// hydration mismatches follow. Typecheck, lint and `next build` are all green through it.
// Fix: wrap the line in a `Box` and mark the inline pieces — `<Text span>`, `component="span"`.

const ROOTS = [
  join(import.meta.dir, "..", "..", "app"),
  join(import.meta.dir, "..", "..", "components"),
];

const BLOCK = [
  "Accordion",
  "Alert",
  "Badge",
  "Box",
  "Card",
  "Code",
  "Divider",
  "Group",
  "List",
  "Paper",
  "Progress",
  "SimpleGrid",
  "Stack",
  "Table",
  "Timeline",
  "blockquote",
  "div",
  "form",
  "ol",
  "p",
  "pre",
  "section",
  "ul",
];

/** A `Text`/`Title` that still renders a block element — `span` in either form opts out. */
const BLOCK_PARENT = /<(Text|Title)\b(?![^>]*\bspan\b)(?![^>]*component=["']span["'])[^>]*>/;

const BLOCK_CHILD = new RegExp(`<(${BLOCK.join("|")})\\b[^>]*>`, "g");

function walk(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
    } else if (entry.endsWith(".tsx")) {
      found.push(path);
    }
  }

  return found;
}

function sources(): { path: string; source: string }[] {
  return ROOTS.flatMap((root) => walk(root)).map((path) => ({
    path,
    source: readFileSync(path, "utf8"),
  }));
}

function blockChildrenIn(body: string): string[] {
  return [...body.matchAll(BLOCK_CHILD)]
    .filter((match) => !/component=["']span["']/.test(match[0]))
    .map((match) => match[1] as string);
}

/** Each `Text`/`Title` element paired with the source between its tags. */
function nestingsIn(source: string): { tag: string; body: string; line: number }[] {
  const found: { tag: string; body: string; line: number }[] = [];
  const opening = new RegExp(BLOCK_PARENT.source, "g");

  for (const match of source.matchAll(opening)) {
    const tag = match[1] as string;
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf(`</${tag}>`, start);
    if (end === -1) continue;

    found.push({
      tag,
      body: source.slice(start, end),
      line: source.slice(0, match.index ?? 0).split("\n").length,
    });
  }

  return found;
}

function offenders(): string[] {
  const found: string[] = [];

  for (const file of sources()) {
    for (const nesting of nestingsIn(file.source)) {
      const children = blockChildrenIn(nesting.body);
      if (children.length === 0) continue;

      const name = file.path.split(/[\\/]/).slice(-3).join("/");
      found.push(
        `${name}:${String(nesting.line)} — <${nesting.tag}> contains <${children.join(">, <")}>`,
      );
    }
  }

  return found;
}

describe("DOM nesting inside Text and Title", () => {
  test("CONTROL: the scan catches the real offender and clears its fixed form", () => {
    const broken = `<Text ff="monospace" size="xs" c="dimmed">
        {beat.text}
        <Badge variant="default" size="xs" radius="sm" ml="xs">attempt 2</Badge>
      </Text>`;

    const fixed = `<Box className={classes.beatLine}>
        <Text span ff="monospace" size="xs" c="dimmed">{beat.text}</Text>
        <Badge component="span" variant="default" size="xs" radius="sm">attempt 2</Badge>
      </Box>`;

    expect(nestingsIn(broken).flatMap((n) => blockChildrenIn(n.body))).toEqual(["Badge"]);
    expect(nestingsIn(fixed).flatMap((n) => blockChildrenIn(n.body))).toEqual([]);
  });

  test("CONTROL: an inline Text inside a Text is not an offender", () => {
    const inline = `<Text ff="monospace" fw={700}>
        {row.numerator}
        <Text span size="xs" c="dimmed">/{row.denominator}</Text>
      </Text>`;

    expect(nestingsIn(inline).flatMap((n) => blockChildrenIn(n.body))).toEqual([]);
  });

  test("reaches the real tree, so the scan is not passing on an empty set", () => {
    expect(sources().length).toBeGreaterThan(20);
    expect(sources().flatMap((file) => nestingsIn(file.source)).length).toBeGreaterThan(50);
  });

  test("no Text or Title renders a block element as a child", () => {
    expect(offenders()).toEqual([]);
  });
});
