// AC-8(b), half two of two. The other half is
// packages/shared/__tests__/messages/no-recording-word.test.ts, and this file exists separately
// because that one passes while the DOM still says "recording": the findings detail page holds a
// verbatim duplicate of EVIDENCE_WITHHELD_TITLE, and AnnotatedTranscript hides a sentence from
// everyone except a screen-reader user. Neither is reachable from a packages/shared sweep.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ALL_FINDINGS_MESSAGES, EVIDENCE_WITHHELD_TITLE } from "@growthmind/shared";

const APPS_WEB = path.join(import.meta.dir, "..", "..");

const SWEPT_DIRECTORIES: readonly string[] = ["app", "components", "lib"];

const FINDINGS_DETAIL_PAGE = path.join(APPS_WEB, "app", "(app)", "findings", "[id]", "page.tsx");

const ANNOTATED_TRANSCRIPT = path.join(
  APPS_WEB,
  "components",
  "findings",
  "AnnotatedTranscript.tsx",
);

// Same gate as the packages/shared half: the NOUN, never the verb. A word boundary on both sides
// is what keeps every code shape out — recordingId, RecordingMetaStamp, recordingSessionKey,
// RECORDING_SUMMARY_PENDING and the [recordingId] route segment all continue with a word
// character exactly where this pattern demands a boundary.
const NOUN = /\brecordings?\b/i;

// The sweep's unit is a string that REACHES THE DOM, not any string in the tree. A bare
// substring scan over apps/web reports 57 lines, of which 47 are identifiers, DTO field names,
// import specifiers, a NOTIFY topic and logger diagnostics — none of them customer-facing, and
// demanding they change would be this sprint widening its own scope. These four positions are
// the ones a customer can actually read, and each is structural rather than a file exemption:
//
//   1. JSX text nodes                          <Text>We are not showing this recording</Text>
//   2. string-valued JSX render attributes     <PageHeader title="Recordings">
//   3. string-valued copy properties           { label: "Recordings" }, { text: "..." }
//   4. SCREAMING_SNAKE copy constants          const SIGNED_OUT_MESSAGE = "..."
//
// `id:`, `topics:` and `key:` are deliberately NOT copy properties: `id: "read-recordings"` is a
// machine value. The CONTROL test below proves each layer fires and each exclusion holds.
const RENDER_ATTRIBUTES: ReadonlySet<string> = new Set([
  "title",
  "label",
  "placeholder",
  "alt",
  "aria-label",
  "description",
  "heading",
  "message",
  "cta",
]);

const COPY_PROPERTIES: ReadonlySet<string> = new Set([
  "label",
  "text",
  "title",
  "message",
  "heading",
  "body",
  "cta",
  "note",
  "headline",
]);

const COPY_CONSTANT = /_(MESSAGE|MESSAGES|TITLE|LABEL|HEADLINE|BODY|CTA|NOTE|TEXT)$/;

interface RenderedString {
  readonly file: string;
  readonly position: string;
  readonly text: string;
}

// A comment is not rendered. Stripping first is what keeps the sweep off the dozen explanatory
// comments in lib/replay and components/live that name the mechanism rather than address anyone.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function renderedStringsIn(relativeFile: string, raw: string): readonly RenderedString[] {
  const source = withoutComments(raw);
  const found: RenderedString[] = [];
  const take = (position: string, text: string): void => {
    found.push({ file: relativeFile, position, text });
  };

  for (const [, text] of source.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    take("jsx-text", text);
  }
  for (const match of source.matchAll(/([A-Za-z-]+)=(["'])([^"']*)\2/g)) {
    if (RENDER_ATTRIBUTES.has(match[1] ?? "")) take(`attribute ${match[1]}`, match[3] ?? "");
  }
  for (const match of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(["'])([^"']*)\2/g)) {
    if (COPY_PROPERTIES.has(match[1] ?? "")) take(`property ${match[1]}`, match[3] ?? "");
  }
  for (const match of source.matchAll(
    /\b(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*(["'`])([^"'`]*)\2/g,
  )) {
    if (COPY_CONSTANT.test(match[1] ?? "")) take(`constant ${match[1]}`, match[3] ?? "");
  }

  return found;
}

function sweepRenderedStrings(): readonly RenderedString[] {
  const found: RenderedString[] = [];

  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const relative = path.relative(APPS_WEB, full).split(path.sep).join("/");
      // The suites are not the product. This file names the noun on every other line.
      if (relative.startsWith("__tests__/")) continue;
      found.push(...renderedStringsIn(relative, readFileSync(full, "utf8")));
    }
  };

  for (const directory of SWEPT_DIRECTORIES) walk(path.join(APPS_WEB, directory));
  return found;
}

describe("no literal rendered from apps/web says recording (AC-8(b), G8)", () => {
  test("CONTROL: every layer fires on rendered copy and clears every code shape", () => {
    const fixture = [
      `// a comment about a recording, which nobody renders`,
      `import { RecordingSummaryCard } from "@/components/replay/RecordingSummaryCard";`,
      `const HREF = \`/replays/\${recording.recordingId}\`;`,
      `const SIGNED_OUT_MESSAGE = "Sign in to watch your recordings.";`,
      `const NAV = { href: ROUTES.replays, label: "Recordings" };`,
      `const FACT = { id: "read-recordings", text: "Recordings of sessions." };`,
      `logger.error("replays: the recording list could not be read", { error });`,
      `export function Page() {`,
      `  return (<>`,
      `    <LiveRefresh topics={["recordings"]} />`,
      `    <PageHeader title="Recordings">`,
      `    <Text>We are not showing this recording</Text>`,
      `    <VisuallyHidden> (opens the recording in a new tab)</VisuallyHidden>`,
      `    <Text>Simulated sessions aren't recorded.</Text>`,
      `  </>);`,
      `}`,
    ].join("\n");

    const caught = renderedStringsIn("fixture.tsx", fixture)
      .filter((found) => NOUN.test(found.text))
      .map((found) => `${found.position}: ${found.text.trim()}`)
      .toSorted();

    // Exactly the six a customer can read, and nothing else.
    expect(caught).toEqual([
      "attribute title: Recordings",
      "constant SIGNED_OUT_MESSAGE: Sign in to watch your recordings.",
      "jsx-text: (opens the recording in a new tab)",
      "jsx-text: We are not showing this recording",
      "property label: Recordings",
      "property text: Recordings of sessions.",
    ]);

    // Named negatives, one per class the sweep must never fire on. Each is a real line from
    // this tree, and each would be an offender under a bare substring scan.
    const missed = caught.join("\n");
    for (const codeShape of [
      "recordingId", // the route segment and the DTO field
      "RecordingSummaryCard", // the import specifier
      '"recordings"', // the NOTIFY wire topic, D1 keeps it
      "read-recordings", // an id, not copy
      "could not be read", // a logger diagnostic
      "a comment about", // a comment
    ]) {
      expect(`${codeShape}: ${missed.includes(codeShape)}`).toBe(`${codeShape}: false`);
    }

    // The verb is correct English and must survive here exactly as it does in the shared half.
    expect(NOUN.test("Simulated sessions aren't recorded.")).toBe(false);
  });

  test("no literal rendered from apps/web contains the noun recording", () => {
    const offenders = sweepRenderedStrings()
      .filter((found) => NOUN.test(found.text))
      .map((found) => `${found.file} [${found.position}]: ${JSON.stringify(found.text.trim())}`);

    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} string(s) rendered from apps/web still say "recording". The ` +
          `customer-facing word is Replays (G8), and this half of the sweep exists because the ` +
          `packages/shared half cannot see any of these. Swept: ${SWEPT_DIRECTORIES.join(", ")}. ` +
          `The verb "recorded" is correct and is not in this gate, nor are identifiers, route ` +
          `segments, import specifiers, wire topics or logger diagnostics. ` +
          `Offenders:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test("the findings detail page imports the withheld-evidence constant rather than duplicating its text", () => {
    const source = readFileSync(FINDINGS_DETAIL_PAGE, "utf8");

    // THE FIX IS THE IMPORT, NOT AN EDIT TO THE LITERAL. Editing the literal into agreement
    // leaves two copies of one sentence and hands the next rename the same miss — the
    // duplication is itself the defect (PATTERNS 2).
    if (!/\bEVIDENCE_WITHHELD_TITLE\b/.test(source)) {
      throw new Error(
        `app/(app)/findings/[id]/page.tsx does not reference EVIDENCE_WITHHELD_TITLE. It ` +
          `hardcodes the sentence instead, so correcting the constant in packages/shared leaves ` +
          `this page rendering the old word — which is exactly why AC-8 has two halves. Import ` +
          `the constant from @growthmind/shared and render it.`,
      );
    }

    // Any findings message reproduced as a literal here is the same defect, whatever its text —
    // so this keeps working after wave 6 rewrites the constant's wording.
    const duplicated = ALL_FINDINGS_MESSAGES.filter((message) => source.includes(message));
    if (duplicated.length > 0) {
      throw new Error(
        `app/(app)/findings/[id]/page.tsx reproduces ${duplicated.length} findings message(s) ` +
          `as literal text while packages/shared already exports them: ` +
          `${duplicated.map((message) => JSON.stringify(message)).join(", ")}. A second copy of ` +
          `a sentence is never updated with the first.`,
      );
    }
    expect(duplicated).toEqual([]);

    expect(EVIDENCE_WITHHELD_TITLE.length).toBeGreaterThan(0);
  });

  test("the annotated transcript's visually-hidden link text says replay", () => {
    const source = readFileSync(ANNOTATED_TRANSCRIPT, "utf8");

    const hidden = [
      ...withoutComments(source).matchAll(/<VisuallyHidden>([^<]*)<\/VisuallyHidden>/g),
    ]
      .map((match) => match[1] ?? "")
      .filter((text) => text.trim().length > 0);

    if (hidden.length === 0) {
      throw new Error(
        `components/findings/AnnotatedTranscript.tsx renders no VisuallyHidden text. The ` +
          `citation link carries "(opens the … in a new tab)" for screen-reader users and it ` +
          `must not be deleted to satisfy this sweep — the accessibility floor (P-2) is that a ` +
          `link opening a new tab says so.`,
      );
    }

    const stillSayingRecording = hidden.filter((text) => NOUN.test(text));
    if (stillSayingRecording.length > 0) {
      throw new Error(
        `screen-reader-only text still says "recording": ` +
          `${stillSayingRecording.map((text) => JSON.stringify(text)).join(", ")}. Text only a ` +
          `screen-reader user hears is customer-facing in full, and is the last place this ` +
          `rename may be allowed to miss.`,
      );
    }
    expect(stillSayingRecording).toEqual([]);
  });
});
