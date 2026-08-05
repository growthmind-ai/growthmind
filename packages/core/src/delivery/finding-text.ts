import type { ResidualPiiKind } from "@growthmind/shared";
import { z } from "zod";

import { scanResidualPii, type ResidualPiiScan } from "./residual-pii";

declare const scannedText: unique symbol;

export type ScannedText = string & { readonly [scannedText]: true };

export interface FindingTextInput {
  readonly headline: string;
  readonly context: readonly string[];
}

export type FindingText =
  | {
      readonly held: false;
      readonly headline: ScannedText;
      readonly context: readonly ScannedText[];
    }
  | { readonly held: true; readonly why: "residual_pii"; readonly kind: ResidualPiiKind }
  | { readonly held: true; readonly why: "unreadable" };

// Concatenating scanned parts cannot introduce anything the scan refused, but `join`
// returns a bare `string` — so the restore lives here, beside the only other assertion.
export function joinScanned(parts: readonly ScannedText[], separator: string): ScannedText {
  return parts.join(separator) as ScannedText;
}

// Trimming removes characters; it can add nothing the scan refused. Callers that need a
// trimmed value get it through the brand rather than dropping to `string` at the seam.
export function trimScanned(text: ScannedText): ScannedText {
  return text.trim() as ScannedText;
}

export const findingContextSchema = z.array(z.string());

export function reviewFindingText(input: FindingTextInput): FindingText {
  // The scan reads a join, which coerces; the verdict brands the elements. Without this
  // parse a non-string element is scanned as its coercion and branded as itself.
  const parsed = findingContextSchema.safeParse(input.context);
  if (!parsed.success) {
    return { held: true, why: "unreadable" };
  }

  const context: readonly string[] = parsed.data;

  let scan: ResidualPiiScan;
  try {
    scan = scanResidualPii([input.headline, ...context].join("\n"));
  } catch {
    return { held: true, why: "unreadable" };
  }

  const [first] = scan.findings;
  if (!scan.clean && first) {
    return { held: true, why: "residual_pii", kind: first.kind };
  }

  return {
    held: false,
    headline: input.headline as ScannedText,
    context: context as readonly ScannedText[],
  };
}
