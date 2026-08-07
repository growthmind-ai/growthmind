// One home for the sentences and event names this page fires. The three refusal sentences
// were byte-identical in two editors, and a copy edit that reaches one of them and not the
// other is the failure that arrangement invites.

export const EMPTY_CORRECTION = "Write the correction first — an empty correction changes nothing.";
export const UNCHANGED_CORRECTION = "Change something first — this is what we already believe.";
export const WRITE_FAILED = "That didn't save. Your text is still here — try again.";

// Plain-English descriptions of what happened, fired on the fact, not the attempt.
export const CONFIRMED_EVENT = "Confirmed a belief on the audience page";
export const CORRECTED_EVENT = "Corrected a belief on the audience page";
export const DROPPED_EVENT = "Dropped a belief on the audience page";
export const REFUSED_EVENT = "A correction was refused before saving";
export const ANSWERED_EVENT = "Answered a doubt on the audience page";

// Fired at the click, not the navigation: the settings page cannot know it was this empty
// state that sent the person there.
export const NAME_WEBSITE_EVENT = "Clicked 'name your website' from the empty audience page";
