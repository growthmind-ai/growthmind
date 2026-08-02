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

export type ReceiptLine = string;

export type PrivacyReceiptInput = {
  readonly inferredInternalDomain: string | null;
  readonly provenance: InternalDomainProvenance | null;
};

function internalDomainLine(input: PrivacyReceiptInput): ReceiptLine {
  const domain = input.inferredInternalDomain?.trim() ?? "";

  if (domain.length === 0 || input.provenance === null) {
    return RECEIPT_INTERNAL_DOMAIN_UNKNOWN;
  }

  return RECEIPT_INTERNAL_DOMAIN_TEMPLATE.replaceAll("{domain}", domain);
}

export function buildPrivacyReceipt(input: PrivacyReceiptInput): readonly ReceiptLine[] {
  return [
    RECEIPT_PATHS_LINE,

    internalDomainLine(input),

    RECEIPT_AUTOMATION_LINE,

    RECEIPT_FAIL_DIRECTION_LINE,

    RECEIPT_IDENTITY_LINE,

    RECEIPT_PROPERTIES_LINE,

    RECEIPT_OUTBOUND_LINE,
  ];
}
