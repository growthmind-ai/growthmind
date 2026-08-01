// THE 44px TAP TARGET, IN ONE HOME (UX §5, binding).
//
// ###########################################################################
// # WHY THIS FILE EXISTS AT ALL.
// #
// # The object below was a module-private `const` in
// # `components/landing/workspace-name.tsx` and a second, hand-written literal
// # inside `components/landing/sign-out-button.tsx`'s JSX. The UX spec is
// # explicit that this sprint must "extend the existing convention into a real
// # shared primitive rather than copying the object a seventh time" — because
// # a convention held together by copying is one edit away from a control that
// # quietly ships at 32px on a phone, on a surface designed mobile-first.
// #
// # THE STYLE CONTRACT DISCOVERS THIS HOME RATHER THAN PINNING ITS PATH. It
// # walks every production source under `apps/web` for a hand-written 44px
// # minimum and requires EXACTLY ONE file to declare it, and that file to
// # EXPORT exactly one such object. A second home fails the row; an unexported
// # one fails it too. So: no local copies, and nothing else in this file.
// ###########################################################################
import type { CSSProperties } from "react";

/**
 * The minimum size every interactive control presents to a thumb.
 *
 * `touchAction: "manipulation"` drops the 300 ms double-tap delay, so a press
 * registers when it looks like it did. The tap-highlight colour is cleared
 * because the theme already draws a `:focus-visible` ring (`app/globals.css`)
 * and the platform's blue-grey flash on top of it reads as a rendering fault
 * on a dark surface.
 */
export const tapTargetStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};
