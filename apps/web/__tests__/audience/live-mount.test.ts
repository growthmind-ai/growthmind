import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { liveTopicSchema } from "@growthmind/shared";

// apps/web has no DOM renderer and the page is an async server component doing database I/O,
// so the mount is read off the source rather than rendered. Weaker than a render, and chosen
// over prop-injecting the page's dependencies to make one possible.
const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDIENCE_PAGE = path.join(WEB_ROOT, "app", "(app)", "audience", "page.tsx");

function audiencePageSource(): string {
  return readFileSync(AUDIENCE_PAGE, "utf8");
}

describe("the audience page hears the model change", () => {
  test("the page mounts LiveRefresh on the business-context topic", () => {
    // Parsed rather than written down, so a rename in packages/shared fails this test instead
    // of leaving it green against a topic nothing publishes (D11).
    const topic = liveTopicSchema.parse("business_context");
    const source = audiencePageSource();

    // The mount names a constant, so the constant's own definition is what binds the topic.
    expect(source).toMatch(/<LiveRefresh\s+topics=\{AUDIENCE_TOPICS\}/);
    expect(source).toMatch(
      new RegExp(
        `const AUDIENCE_TOPICS = \\["${topic}"\\] as const satisfies readonly LiveTopic\\[\\]`,
      ),
    );
  });

  // A founder landing after the research run sees the settled model only while the page
  // renders from the database on load; the live mount is the second half of that, never a
  // replacement for it.
  test("the page keeps force-dynamic", () => {
    expect(audiencePageSource()).toContain('export const dynamic = "force-dynamic"');
  });
});
