import type {
  ReplayEventsResult,
  ReplayListRequest,
  ReplayListResult,
  ReplaySourceKind,
  ReplaySourceValidation,
} from "@growthmind/shared";

// `resumeFrom` is a cursor this source itself reported on an earlier pull of the same
// recording, so its shape is the source's business and never the caller's.
export interface ReplayPullOptions {
  readonly resumeFrom?: string | null;
}

export interface ReplaySource {
  readonly kind: ReplaySourceKind;

  validate(): Promise<ReplaySourceValidation>;

  listRecordings(request: ReplayListRequest): Promise<ReplayListResult>;

  pullEvents(recordingId: string, options?: ReplayPullOptions): Promise<ReplayEventsResult>;
}
