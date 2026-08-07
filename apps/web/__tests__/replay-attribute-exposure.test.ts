import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// rrweb 2.1.1 masks text nodes and input values and nothing else: transformAttribute
// rewrites only URL attributes and never consults the masking predicate, and the bundle
// exposes no maskAttributeFn. Whatever a component interpolates into one of these five
// attributes reaches rrweb.com verbatim once NEXT_PUBLIC_RRWEB_PUBLIC_KEY is set.
// see .ai/prds/04-08-26/add-o-027-replay-source-port.md § AD-5b
const EXPOSED_ATTRIBUTES = ["title", "alt", "placeholder", "aria-label", "aria-describedby"];

const NAMES = EXPOSED_ATTRIBUTES.join("|");

// The JSX form, the quoted object-literal form that gets spread onto an element, and any
// data-* binding. An UNQUOTED object key (`placeholder: field.placeholder`) is not
// detected: unquoted `title:`/`alt:` are indistinguishable by regex from interface fields
// and Next.js metadata, and matching them buries the register in false positives. The
// hyphenated attributes cannot be written unquoted, so the quoted pattern is exact there.
const BINDINGS = [
  new RegExp(`\\b(${NAMES})=\\{`, "g"),
  new RegExp(`["'](${NAMES})["']\\s*:\\s*(?!["'])`, "g"),
  /\bdata-[a-z-]+=\{/g,
];

// Counted per file, so adding a binding to a file already listed here fails too — a file
// name alone would let a second binding in under the first one's classification.
// "our-copy" carries only copy this repo authored; "customer-data" carries something a
// customer or their end users typed, which rrweb cannot mask out of an attribute.
const REVIEWED: Record<string, { readonly bindings: number; readonly kind: Kind }> = {
  "app/(app)/(preview)/experiments/[id]/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/findings/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/findings/[id]/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/agent/page.tsx": { bindings: 1, kind: "our-copy" },
  // The page title, a constant of ours. The counts /data renders never reach an attribute.
  "app/(app)/data/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/settings/page.tsx": { bindings: 5, kind: "our-copy" },
  "components/settings/BusinessContext.tsx": { bindings: 1, kind: "our-copy" },
  // The inline fact editor has no visible label, so it names itself with a constant of
  // ours. B-049's rule holds: what reaches the attribute is our copy, never the fact.
  "components/settings/FactRow.tsx": { bindings: 1, kind: "our-copy" },
  "app/(auth)/sign-in/sign-in-form.tsx": { bindings: 3, kind: "our-copy" },
  "app/(auth)/sign-up/sign-up-form.tsx": { bindings: 3, kind: "our-copy" },
  "app/(auth)/social-buttons.tsx": { bindings: 1, kind: "our-copy" },
  "app/(first-run)/first-run/page.tsx": { bindings: 1, kind: "our-copy" },
  "components/app/AppNav.tsx": { bindings: 1, kind: "our-copy" },
  // bellAriaLabel's sentence with a count of the org's own unread rows. A count is not
  // something a customer or their users wrote, and no sentence, name or subject id
  // reaches an attribute from the bell — those are text.
  "components/notifications/Bell.tsx": { bindings: 1, kind: "our-copy" },
  // Both carry a tone from a closed union of ours — the delivery state's, and the lane
  // line's quiet/alarm/cold. The delivered message itself is text, never an attribute, so
  // nothing a customer or their users wrote reaches one from this page.
  "components/channel/DeliveryCard.tsx": { bindings: 1, kind: "our-copy" },
  "components/channel/LaneStatus.tsx": { bindings: 1, kind: "our-copy" },
  "components/first-run/AgentPanelBody.tsx": { bindings: 1, kind: "our-copy" },
  "components/first-run/FirstRunClient.tsx": { bindings: 2, kind: "our-copy" },
  "components/first-run/Roadmap.tsx": { bindings: 1, kind: "our-copy" },
  "components/first-run/Strip.tsx": { bindings: 1, kind: "our-copy" },
  "components/landing/workspace-name.tsx": { bindings: 1, kind: "our-copy" },
  "components/preview/StartInChannel.tsx": { bindings: 1, kind: "our-copy" },
  // The pill's own name is composed from text nodes via aria-labelledby, so what is left here is
  // the clear control's sentence, the bar's group name, and a variant from a closed union.
  "components/replay/filters/FilterBar.tsx": { bindings: 3, kind: "our-copy" },
  // The axis word twice (dialog and listbox), the search placeholder — an example we authored,
  // never a real domain — and a zero flag. Every option's label reaches the name as text.
  "components/replay/filters/FilterPanel.tsx": { bindings: 4, kind: "our-copy" },
  "components/slack/SlackConnection.tsx": { bindings: 1, kind: "our-copy" },
  "components/ui/CopyableBlock.tsx": { bindings: 1, kind: "our-copy" },
  "components/ui/Logo.tsx": { bindings: 1, kind: "our-copy" },
};

type Kind = "our-copy" | "customer-data";

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === ".next") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      tsxFiles(full, acc);
    } else if (entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

function countBindings(source: string): number {
  let total = 0;
  for (const pattern of BINDINGS) {
    pattern.lastIndex = 0;
    total += (source.match(pattern) ?? []).length;
  }
  return total;
}

function bindingCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of tsxFiles(WEB_ROOT)) {
    const found = countBindings(readFileSync(file, "utf8"));
    if (found > 0) {
      counts[path.relative(WEB_ROOT, file).replaceAll("\\", "/")] = found;
    }
  }
  return counts;
}

describe("replay attribute exposure", () => {
  test("every binding on an attribute rrweb cannot mask has been counted and classified", () => {
    const expected = Object.fromEntries(
      Object.entries(REVIEWED).map(([file, row]) => [file, row.bindings]),
    );

    expect(bindingCounts()).toEqual(expected);
  });

  test("the scan sees a planted binding in each of the three forms", () => {
    expect(countBindings('<td title={customer.fullName}>{"x"}</td>')).toBe(1);
    expect(countBindings('const shared = { "aria-label": customer.fullName };')).toBe(1);
    expect(countBindings("<div data-user-email={customer.email} />")).toBe(1);
  });

  // B-049 proved this channel is real: a live PostHog recording of /settings held
  // "What /settings is for" verbatim, from an aria-label. The fix was to stop putting the
  // path in the attribute (aria-labelledby names the visible element instead), not to
  // classify it and move on — so the register now holds the stronger rule.
  test("no binding carries customer data, because there is nowhere safe to put it", () => {
    const carrying = Object.entries(REVIEWED)
      .filter(([, row]) => row.kind === "customer-data")
      .map(([file]) => file);

    expect(carrying).toEqual([]);
  });
});
