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
  "app/(app)/(preview)/findings/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/(preview)/findings/[id]/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/(preview)/fixes/[id]/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/agent/page.tsx": { bindings: 1, kind: "our-copy" },
  "app/(app)/settings/page.tsx": { bindings: 5, kind: "our-copy" },
  "components/settings/SiteResearch.tsx": { bindings: 1, kind: "our-copy" },
  "app/(auth)/sign-in/sign-in-form.tsx": { bindings: 3, kind: "our-copy" },
  "app/(auth)/sign-up/sign-up-form.tsx": { bindings: 3, kind: "our-copy" },
  "app/(auth)/social-buttons.tsx": { bindings: 1, kind: "our-copy" },
  "app/(first-run)/first-run/page.tsx": { bindings: 1, kind: "our-copy" },
  "components/app/AppNav.tsx": { bindings: 1, kind: "our-copy" },
  "components/first-run/AgentPanelBody.tsx": { bindings: 1, kind: "our-copy" },
  "components/first-run/FirstRunClient.tsx": { bindings: 2, kind: "our-copy" },
  "components/first-run/Roadmap.tsx": { bindings: 1, kind: "our-copy" },
  "components/first-run/Strip.tsx": { bindings: 1, kind: "our-copy" },
  "components/landing/workspace-name.tsx": { bindings: 1, kind: "our-copy" },
  "components/preview/StartInChannel.tsx": { bindings: 1, kind: "our-copy" },
  "components/slack/SlackConnection.tsx": { bindings: 1, kind: "our-copy" },
  "components/ui/CopyableBlock.tsx": { bindings: 1, kind: "our-copy" },
  "components/ui/Logo.tsx": { bindings: 1, kind: "our-copy" },
  // Interpolates the customer's own page paths into an aria-label.
  "components/settings/PageRoles.tsx": { bindings: 2, kind: "customer-data" },
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

  test("the register records that capture must stay off while a binding carries customer data", () => {
    // Not a gate on the recorder — the key being unset is what keeps capture off. This
    // says why it must stay unset, and goes red when the last such binding is resolved,
    // which is the moment to revisit both this row and the warning in .env.example.
    const carrying = Object.entries(REVIEWED)
      .filter(([, row]) => row.kind === "customer-data")
      .map(([file]) => file);

    expect(carrying).toEqual(["components/settings/PageRoles.tsx"]);
  });
});
