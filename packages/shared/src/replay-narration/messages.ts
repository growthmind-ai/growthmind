export const RECORDING_FLOOR_HEADLINE_TEMPLATE = "Someone spent {duration} here.";

export const RECORDING_FLOOR_ONE_PAGE_TEMPLATE = "They stayed on {page}.";

export const RECORDING_FLOOR_PAGES_TEMPLATE = "They moved through {count} pages.";

export const RECORDING_FLOOR_NO_PAGE = "No page address was recorded.";

export const RECORDING_FLOOR_CLICKS_TEMPLATE = "They clicked {count} times.";

export const RECORDING_FLOOR_NOTHING = "Nothing was recorded in this session.";

export const RECORDING_FLOOR_DEAD_CLICKS_TEMPLATE =
  "{count} of those clicks changed nothing on the screen.";

export const RECORDING_FLOOR_RAGE_TEMPLATE =
  "They pressed the same thing repeatedly {count} times.";

export const RECORDING_FLOOR_REFOCUS_TEMPLATE =
  "They came back to a field they had left {count} times.";

export const RECORDING_FLOOR_ABANDONED_TEMPLATE =
  "They left {count} fields without typing in them.";

// Every substituted value dropped, so the row survives with its provenance when even the
// floor's own words cannot be shown.
export const RECORDING_FLOOR_WITHHELD_HEADLINE = "A session was recorded here.";

export const RECORDING_FLOOR_WITHHELD_CONTEXT =
  "What happened in it could not be described in a way we could show.";

export const RECORDING_SUMMARY_SOURCE_MESSAGES = {
  model_rendered: "This includes a short written explanation of what happened.",
  floor_no_key_configured:
    "This shows what they did on its own. Written explanations are not set up for this installation yet.",
  floor_cap_exhausted:
    "This shows what they did on its own. The limit on written explanations for this product was already reached.",
  floor_model_call_failed:
    "This shows what they did on its own. An attempt to add a written explanation did not complete.",
  floor_model_output_invalid:
    "This shows what they did on its own. What came back could not be read as a written explanation.",
  floor_model_text_rejected:
    "This shows what they did on its own. A written explanation was generated but did not pass our checks, so we left it out.",
} as const;

// Rendered on a card with a player under it and on a list row with only a link, so it names
// the mechanism and never a position on screen.
export const RECORDING_SUMMARY_PENDING =
  "We have not read this recording yet. The description appears here on its own when it is ready.";

export const RECORDING_SUMMARY_HELD =
  "We read this recording, but what we wrote about it could not be shown.";

// "Analytics connection" is what /settings and REPLAY_NO_CONNECTION call it, and the sentence
// has to stay true whether none is connected or the one connected cannot be read.
export const RECORDING_SUMMARY_NO_SOURCE =
  "We cannot read the analytics connection for this project, so no description is coming for this recording.";

export const RECORDING_SUMMARY_NO_SOURCE_LINK = "Check your analytics connection";

export const RECORDING_SUMMARY_NOT_CONFIGURED =
  "This installation is not set up to read recordings, so no description is coming. Whoever runs Growthmind here has to turn it on.";

// No instruction to reload: the page re-reads itself on any recordings publish, so naming a
// manual action would describe a product that no longer exists.
export const RECORDING_SUMMARY_READ_FAILED =
  "Something went wrong looking up the description for this recording. The recording itself is fine, and we will show the description if we can read it.";

export const RECORDING_SUMMARY_PARTIAL =
  "We could only read part of this recording, so this description may be missing some of what happened. The rest is still in your analytics.";

export const ALL_RECORDING_NARRATION_MESSAGES: readonly string[] = [
  RECORDING_SUMMARY_PENDING,
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_NO_SOURCE,
  RECORDING_SUMMARY_NO_SOURCE_LINK,
  RECORDING_SUMMARY_NOT_CONFIGURED,
  RECORDING_SUMMARY_READ_FAILED,
  RECORDING_SUMMARY_PARTIAL,
  RECORDING_FLOOR_HEADLINE_TEMPLATE,
  RECORDING_FLOOR_ONE_PAGE_TEMPLATE,
  RECORDING_FLOOR_PAGES_TEMPLATE,
  RECORDING_FLOOR_NO_PAGE,
  RECORDING_FLOOR_CLICKS_TEMPLATE,
  RECORDING_FLOOR_NOTHING,
  RECORDING_FLOOR_DEAD_CLICKS_TEMPLATE,
  RECORDING_FLOOR_RAGE_TEMPLATE,
  RECORDING_FLOOR_REFOCUS_TEMPLATE,
  RECORDING_FLOOR_ABANDONED_TEMPLATE,
  RECORDING_FLOOR_WITHHELD_HEADLINE,
  RECORDING_FLOOR_WITHHELD_CONTEXT,
  ...Object.values(RECORDING_SUMMARY_SOURCE_MESSAGES),
];
