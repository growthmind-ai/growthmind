import type {
  SessionSourceKind,
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
} from "@growthmind/shared";

export interface SessionSource {
  readonly kind: SessionSourceKind;

  validate(): Promise<SessionSourceValidation>;

  pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult>;
}
