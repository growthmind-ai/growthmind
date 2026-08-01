// THE PRIVACY POSTURE RECEIPT — A RECEIPT, NOT A SETTINGS PANEL
// (O-008, AD-2, FR-O8, PRD ruling R2).
//
// ###########################################################################
// # WHY THIS IS A RECEIPT.
// #
// # `docs/mvp.md` §5 asked step 2's second confirmation to be "masking config
// # verified". THERE IS NO MASKING CONFIG TO VERIFY: `packages/sdk-js` is a
// # 19-line stub whose own comment says nothing is implemented yet, capture is
// # the vendor's, and no masking field exists anywhere in the schema. A
// # confirmation that verifies nothing is a lie shipped to a customer at the
// # exact moment they asked "are you sending my users' personal data
// # anywhere?".
// #
// # R2 reframes it as a READ-ONLY POSTURE RECEIPT over what is actually
// # shipped and provable — which satisfies §5's real requirement ("must not put
// # PII in the stream, AND MUST BE ABLE TO PROVE IT") without claiming a
// # capability this tree does not have.
// #
// # READ-ONLY IS CARRIED BY TYPE. `ReceiptLine` is a string, so there is no
// # property a field, a toggle, an action or a default value could hang off. A
// # later edit that wants a control has to change the alias first, in the open
// # — the same technique AD-19 uses on the `coming-next` arm, applied to the
// # same class of quiet regression.
// ###########################################################################
//
// ── SEVEN LINES, AND THE CLOSING LINE IS NOT ONE OF THEM ────────────────────
//
// `RECEIPT_CLOSING_LINE` ("Nothing here is a setting. There is nothing to
// switch on.") renders BENEATH the block and must stay outside it: it is the
// sentence that makes this a receipt, and a line INSIDE the block offering to
// switch something on is exactly what the receipt's own audit forbids. Adding
// it to the array would make the receipt contradict itself in one paragraph.
//
// ── R-CAPTURE ───────────────────────────────────────────────────────────────
//
// No line may say masking, redaction, scrubbing, anonymising, encryption,
// recording, replay or capture. Each of the seven is backed by a shipped,
// citable fact (the PRD's table names the file and line for every one); a
// receipt that overstates is the exact failure R2 exists to remove, restated
// more confidently.

import {
  RECEIPT_AUTOMATION_LINE,
  RECEIPT_FAIL_DIRECTION_LINE,
  RECEIPT_IDENTITY_LINE,
  RECEIPT_INTERNAL_DOMAIN_TEMPLATE,
  RECEIPT_INTERNAL_DOMAIN_UNKNOWN,
  RECEIPT_OUTBOUND_LINE,
  RECEIPT_PATHS_LINE,
  RECEIPT_PROPERTIES_LINE,
} from "./messages";
import type { InternalDomainProvenance } from "../session-source/types";

/**
 * ONE LINE, AND IT IS A STRING.
 *
 * Not a stylistic choice — it is the whole mechanism behind "the receipt
 * exposes no editable control". Read the header before widening it.
 */
export type ReceiptLine = string;

/** What the receipt needs, and nothing more. */
export type PrivacyReceiptInput = {
  readonly inferredInternalDomain: string | null;
  readonly provenance: InternalDomainProvenance | null;
};

/**
 * Row 2 of R2's table, in whichever of its two forms the org has earned.
 *
 * BOTH HALVES ARE REQUIRED BEFORE THE VALUE IS NAMED. The template does not
 * merely state the domain, it states WHERE THE GUESS CAME FROM ("worked out
 * from the email address that created this workspace") — so a domain arriving
 * without its provenance would have that clause asserted on its behalf by this
 * file, which is the one thing a receipt may never do. Absent provenance takes
 * the same honest sentence as an absent domain.
 *
 * A blank string is treated as absent: an empty domain named on screen would
 * read as a rendering fault, and it is not one.
 *
 * FR-O28 (naming the value) IS THE EXPECTED-CUT HALF. If it goes, this function
 * loses its branch and returns `RECEIPT_INTERNAL_DOMAIN_UNKNOWN`'s sibling
 * sentence unconditionally — the receipt stays seven complete lines, which is
 * exactly the shape the no-domain case already ships.
 */
function internalDomainLine(input: PrivacyReceiptInput): ReceiptLine {
  const domain = input.inferredInternalDomain?.trim() ?? "";

  if (domain.length === 0 || input.provenance === null) {
    // THE F-1/F-2 FAIL DIRECTION, SAID OUT LOUD. It never states the absence as
    // an error the founder must go and fix. Nothing is broken: an exclusion
    // rule that fires on a superset of its target would erase the evidence
    // behind a finding, so this product fails toward setting NOTHING aside.
    return RECEIPT_INTERNAL_DOMAIN_UNKNOWN;
  }

  return RECEIPT_INTERNAL_DOMAIN_TEMPLATE.replaceAll("{domain}", domain);
}

/**
 * The seven lines, in R2's order, every time.
 *
 * THE COUNT DOES NOT MOVE WITH THE INPUT. The no-domain case SUBSTITUTES a
 * sentence at the same index; it does not drop one. A six-line receipt in the
 * case where we know least is the case where a founder most needs the seventh
 * line — and a receipt that reorders itself is one nobody can compare against
 * the one they read yesterday.
 */
export function buildPrivacyReceipt(input: PrivacyReceiptInput): readonly ReceiptLine[] {
  return [
    // 1. URL paths, stored normalised and versioned, never raw.
    RECEIPT_PATHS_LINE,
    // 2. Internal traffic — or the reason we set none aside.
    internalDomainLine(input),
    // 3. Bots, headless browsers and coding agents.
    RECEIPT_AUTOMATION_LINE,
    // 4. The fail direction, declared.
    RECEIPT_FAIL_DIRECTION_LINE,
    // 5. Identity as a keyed one-way stand-in.
    RECEIPT_IDENTITY_LINE,
    // 6. No bag of event properties at all.
    RECEIPT_PROPERTIES_LINE,
    // 7. Every outbound message scanned for leftover personal detail.
    RECEIPT_OUTBOUND_LINE,
  ];
}
