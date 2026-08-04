import type { ResidualPiiKind } from "@growthmind/shared";

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

export function reviewFindingText(input: FindingTextInput): FindingText {
  let scan: ResidualPiiScan;

  // Composition sits inside the guard: an element that cannot be read as text detonates
  // in the join, before the scanner ever sees it.
  try {
    scan = scanResidualPii([input.headline, ...input.context].join("\n"));
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
    context: input.context as readonly ScannedText[],
  };
}
