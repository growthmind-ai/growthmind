import type {
  ReplayEventsResult,
  ReplayListRequest,
  ReplayListResult,
  ReplaySourceKind,
  ReplaySourceValidation,
} from "@growthmind/shared";

export interface ReplaySource {
  readonly kind: ReplaySourceKind;

  validate(): Promise<ReplaySourceValidation>;

  listRecordings(request: ReplayListRequest): Promise<ReplayListResult>;

  pullEvents(recordingId: string): Promise<ReplayEventsResult>;
}
