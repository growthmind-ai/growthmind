import { isCleanForDelivery } from "../delivery/residual-pii";
import type { DomSegments } from "./nodes";
import { PAGE_ROOT_TAG_NAMES, resolveControlAt, segmentAt } from "./nodes";
import type { ReplayFact } from "./parse";
import { RRWEB_MOUSE_INTERACTION } from "./parse";
import type { PageAction } from "./types";

export const LINK_TAG_NAME = "a";

export const HREF_ATTRIBUTE = "href";

const LOCATION_PARTS = /^([a-z][\w+.-]*:\/\/[^/?#\s]+)([^?#\s]*)/i;

// One ordered fallback, and every producer of a page beat reads it, so one URL cannot get two
// answers depending on which producer saw it. Dropping the query wholesale is not a heuristic
// about what looks like a secret: the path is the half that carries growth meaning and the query
// is the half where tokens, ids and addresses live (B-013, B-060).
export function deliverableLocation(href: string): string | null {
  const whole = href.trim();
  if (whole.length === 0) return null;
  if (isCleanForDelivery(whole)) return whole;

  const parts = LOCATION_PARTS.exec(whole);
  if (parts === null) return null;

  const origin = parts[1] ?? "";
  const located = `${origin}${parts[2] ?? ""}`;

  if (located !== whole && isCleanForDelivery(located)) return located;
  return isCleanForDelivery(origin) ? origin : null;
}

export type NavigationDraft = {
  readonly atMs: number;

  readonly order: number;
  readonly action: PageAction;
};

// rrweb writes a Meta event on document load and never again, so an App Router route change
// leaves no record of itself (B-060). What it does leave is the page being rebuilt: a mutation
// that takes children off <body>.
function replacesPage(fact: ReplayFact, segments: DomSegments): boolean {
  if (fact.kind !== "mutation") return false;

  const segment = segmentAt(segments, fact.tsMs);
  if (segment === null) return false;

  return fact.removedParentIds.some((parentId) =>
    PAGE_ROOT_TAG_NAMES.includes(segment.index.get(parentId)?.tagName ?? ""),
  );
}

type Activation = { readonly href: string | null };

function activatedLink(fact: ReplayFact, segments: DomSegments): Activation | null {
  if (fact.kind !== "mouse" || fact.interaction !== RRWEB_MOUSE_INTERACTION.click) return null;

  const element = resolveControlAt(segments, fact.nodeId, fact.tsMs);
  if (element.tagName !== LINK_TAG_NAME) return null;

  const href = element.attributes[HREF_ATTRIBUTE];
  if (href === undefined || href.length === 0) return null;

  return { href: deliverableLocation(href) };
}

// A rebuild with no link behind it is a route change this walk cannot name, and a page beat
// carrying a guessed href would be worse than the silence.
export function navigationDrafts(
  facts: readonly ReplayFact[],
  segments: DomSegments,
  firstTsMs: number,
): readonly NavigationDraft[] {
  const drafts: NavigationDraft[] = [];
  let activated: Activation | null = null;

  for (const [order, fact] of facts.entries()) {
    const link = activatedLink(fact, segments);
    if (link !== null) {
      activated = link;
      continue;
    }

    if (activated === null || !replacesPage(fact, segments)) continue;

    const atMs = fact.tsMs - firstTsMs;
    const href = activated.href;
    drafts.push({
      atMs,
      order,
      action: { kind: "page", atMs, ...(href === null ? {} : { href }) },
    });
    activated = null;
  }

  return drafts;
}
