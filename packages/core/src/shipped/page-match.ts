import { isNormalisedUrlPath, normaliseUrlPath } from "@growthmind/shared";

import type { SessionTimeline } from "../detect/types";
import { sessionWalk } from "../spine/walk";

export type ReplayPageMatch = {
  readonly matched: boolean;

  // recording_summaries carries no normalisation-version column to read one from.
  readonly normalisationVersion: null;
};

const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WEB_SCHEME = /^https?:\/\//i;

// The normaliser roots whatever it is given, so prose and non-web schemes come back as paths:
// "Reports page" as `/reports page`, `mailto:x@y.com` as `/:id`. The caller naming the page is an
// LLM, so prose is the likeliest wrong input, and a rooted one books a change key the spine can
// never match — silence until the readout answers out of nothing, rather than a refusal the agent
// can act on.
function isPlausiblePageAddress(href: string): boolean {
  const trimmed = href.trim();

  if (/\s/.test(trimmed)) return false;

  return !ANY_SCHEME.test(trimmed) || WEB_SCHEME.test(trimmed);
}

// A page address written by hand — a replay href, or the page a coding agent names in a report —
// keeps its origin, query and the author's own casing; the spine's path is the normaliser's
// output. Absolute first, because normalisePath would root the scheme.
export function normalisedPageAddress(href: string): string | null {
  if (!isPlausiblePageAddress(href)) return null;

  const fromUrl = normaliseUrlPath(null, href);
  const normalised = fromUrl ?? normaliseUrlPath(href, null);

  if (normalised === null) return null;
  return isNormalisedUrlPath(normalised) ? normalised : null;
}

export function pageMatches(page: string, href: string): boolean {
  return normalisedPageAddress(href) === page;
}

export function matchReplayPages(page: string, pages: readonly string[]): ReplayPageMatch {
  return {
    matched: pages.some((href) => pageMatches(page, href)),
    normalisationVersion: null,
  };
}

export function matchesSpineWalk(page: string, session: SessionTimeline): boolean {
  return sessionWalk(session).includes(page);
}
