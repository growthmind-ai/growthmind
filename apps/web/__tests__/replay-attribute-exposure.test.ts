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

const BINDING = new RegExp(`\\b(${EXPOSED_ATTRIBUTES.join("|")})=\\{`, "g");

// Every dynamic binding on an exposed attribute, classified. A binding that carries only
// copy this repo authored is safe to record; one that carries anything a customer or their
// end users typed is not, and is listed here so the risk is counted rather than assumed.
const REVIEWED: Record<string, "our-copy" | "customer-data"> = {
  "app/(app)/(preview)/experiments/[id]/page.tsx": "our-copy",
  "app/(app)/(preview)/findings/page.tsx": "our-copy",
  "app/(app)/(preview)/findings/[id]/page.tsx": "our-copy",
  "app/(app)/(preview)/fixes/[id]/page.tsx": "our-copy",
  "app/(app)/settings/page.tsx": "our-copy",
  "app/(auth)/sign-in/sign-in-form.tsx": "our-copy",
  "app/(auth)/sign-up/sign-up-form.tsx": "our-copy",
  "app/(auth)/social-buttons.tsx": "our-copy",
  "app/(first-run)/first-run/page.tsx": "our-copy",
  "components/first-run/AgentPanelBody.tsx": "our-copy",
  "components/first-run/FirstRunClient.tsx": "our-copy",
  "components/first-run/Roadmap.tsx": "our-copy",
  "components/first-run/Strip.tsx": "our-copy",
  "components/landing/workspace-name.tsx": "our-copy",
  "components/preview/StartInChannel.tsx": "our-copy",
  "components/slack/SlackConnection.tsx": "our-copy",
  "components/ui/CopyableBlock.tsx": "our-copy",
  // Interpolates the customer's own page paths into an aria-label.
  "components/settings/PageRoles.tsx": "customer-data",
};

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

function filesWithBindings(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(WEB_ROOT)) {
    BINDING.lastIndex = 0;
    if (BINDING.test(readFileSync(file, "utf8"))) {
      found.push(path.relative(WEB_ROOT, file).replaceAll("\\", "/"));
    }
  }
  return found.toSorted();
}

describe("replay attribute exposure", () => {
  test("every dynamic binding on an unmaskable attribute has been classified", () => {
    expect(filesWithBindings()).toEqual(Object.keys(REVIEWED).toSorted());
  });

  test("the scan sees a planted binding", () => {
    BINDING.lastIndex = 0;
    expect(BINDING.test('<td title={customer.fullName}>{"x"}</td>')).toBe(true);
  });

  test("capture stays off while any binding carries customer data", () => {
    const unresolved = Object.entries(REVIEWED)
      .filter(([, kind]) => kind === "customer-data")
      .map(([file]) => file);

    // The recorder cannot mask these, so the only lever is not recording. When this list
    // empties — or those attributes stop carrying customer data — capture can be enabled.
    expect(unresolved.length > 0 ? "capture-must-stay-off" : "capture-may-be-enabled").toBe(
      "capture-must-stay-off",
    );
  });
});
