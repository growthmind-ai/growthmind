import type { MeasuredCount } from "../counts/measured-count";
import type { FixSpecInput } from "./fix-spec";

export const FIX_SPEC_PAYLOAD_VERSION = 1;

export type FixSpecPayload = {
  readonly payloadVersion: number;

  readonly candidate: unknown;

  readonly signals: readonly unknown[];
};

export class UnknownFixSpecPayloadVersionError extends Error {
  override readonly name = "UnknownFixSpecPayloadVersionError";

  readonly payloadVersion: unknown;

  constructor(payloadVersion: unknown) {
    super(
      `fix_spec_payload_unknown_version: this payload was written under version ` +
        `${String(payloadVersion)}, and only version ${String(FIX_SPEC_PAYLOAD_VERSION)} can be read`,
    );
    this.payloadVersion = payloadVersion;
  }
}

const NOT_IMPLEMENTED = "rehydrate: the fix-spec payload boundary is not implemented";

export function serialiseFixSpecInput(input: FixSpecInput): FixSpecPayload {
  void input;
  throw new Error(NOT_IMPLEMENTED);
}

export function rehydrateFixSpecInput(payload: unknown): FixSpecInput {
  void payload;
  throw new Error(NOT_IMPLEMENTED);
}

export function toMeasuredCount(row: unknown): MeasuredCount {
  void row;
  throw new Error(NOT_IMPLEMENTED);
}
