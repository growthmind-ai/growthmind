import { isNormalisedUrlPath, normaliseUrlPath } from "@growthmind/shared";

import type { SessionTimeline } from "../detect/types";
import { sessionWalk } from "../spine/walk";

export type ReplayPageMatch = {
  readonly matched: boolean;

  // recording_summaries carries no normalisation-version column to read one from.
  readonly normalisationVersion: null;
};

// A replay href keeps its origin, query and the developer's own casing; the spine's path is the
// normaliser's output. Absolute first, because normalisePath would root the scheme.
export function normalisedReplayPage(href: string): string | null {
  const fromUrl = normaliseUrlPath(null, href);
  const normalised = fromUrl ?? normaliseUrlPath(href, null);

  if (normalised === null) return null;
  return isNormalisedUrlPath(normalised) ? normalised : null;
}

export function pageMatches(page: string, href: string): boolean {
  return normalisedReplayPage(href) === page;
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
