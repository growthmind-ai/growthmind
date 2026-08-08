import type { ProviderId, ProviderRail } from "../onboarding/providers";

export const CONNECTION_TONES = ["live", "waiting", "attention", "off"] as const;

export type ConnectionTone = (typeof CONNECTION_TONES)[number];

export interface ConnectionFact {
  readonly label: string;

  readonly value: string;
}

export interface ConnectionCardView {
  // Both null on the card describing the customer's own product, which no vendor supplies.
  // Every other card names the product it is a connection to, so a reader never has to
  // recognise a hostname to know who they are connected to.
  readonly rail: ProviderRail | null;
  readonly providerId: ProviderId | null;

  readonly title: string;

  readonly headline: string;

  readonly tone: ConnectionTone;
  readonly statusLabel: string;

  readonly statement: string;

  readonly facts: readonly ConnectionFact[];
}
