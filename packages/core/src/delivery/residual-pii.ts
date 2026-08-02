import type { ResidualPiiKind } from "@growthmind/shared";

export type ResidualPiiFinding = {
  readonly kind: ResidualPiiKind;
  readonly at: number;
};

export type ResidualPiiScan = {
  readonly clean: boolean;
  readonly findings: readonly ResidualPiiFinding[];
};

type Detector = {
  readonly kind: ResidualPiiKind;
  readonly source: string;
  readonly flags: string;
};

const DETECTORS: readonly Detector[] = [
  {
    kind: "email_address",
    source: String.raw`[\w.!#$%&'*+/=?^_\`{|}~-]+@[\w-]+(?:\.[\w-]+)+`,
    flags: "g",
  },

  {
    kind: "credential",
    source: String.raw`\b(?:sk|pk|rk|api|key|token|bearer|ghp|gho|xox[baprs])[-_][A-Za-z0-9\-_]{16,}`,
    flags: "gi",
  },
  {
    kind: "credential",
    source: String.raw`\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}`,
    flags: "g",
  },

  {
    kind: "payment_card",
    source: String.raw`\b(?:\d[ -]?){12,18}\d\b`,
    flags: "g",
  },

  {
    kind: "ip_address",
    source: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    flags: "g",
  },

  {
    kind: "phone_number",
    source: String.raw`(?:\+\d[\d\s().-]{7,}\d)|(?:\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b)`,
    flags: "g",
  },
];

const AMBIGUOUS_DIGIT_RUN = String.raw`\b\d{12,}\b`;

export function scanResidualPii(text: string): ResidualPiiScan {
  const source = typeof text === "string" ? text : String(text);

  if (source.length === 0) {
    return { clean: true, findings: [] };
  }

  const findings: ResidualPiiFinding[] = [];
  const claimed: { start: number; end: number }[] = [];

  function overlapsClaimed(start: number, end: number): boolean {
    return claimed.some((span) => start < span.end && end > span.start);
  }

  for (const detector of DETECTORS) {
    const pattern = new RegExp(detector.source, detector.flags);
    let match = pattern.exec(source);

    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (!overlapsClaimed(start, end)) {
        claimed.push({ start, end });
        findings.push({ kind: detector.kind, at: start });
      }

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }

      match = pattern.exec(source);
    }
  }

  const ambiguous = new RegExp(AMBIGUOUS_DIGIT_RUN, "g");
  let bare = ambiguous.exec(source);

  while (bare !== null) {
    const start = bare.index;
    const end = start + bare[0].length;

    if (!overlapsClaimed(start, end)) {
      claimed.push({ start, end });
      findings.push({ kind: "payment_card", at: start });
    }

    bare = ambiguous.exec(source);
  }

  findings.sort((a, b) => a.at - b.at);

  return { clean: findings.length === 0, findings };
}

export function isCleanForDelivery(text: string): boolean {
  return scanResidualPii(text).clean;
}
