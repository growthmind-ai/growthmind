import type { PostResult } from "../../src/delivery/poster";
import type {
  ConnectRefusalCode,
  ConnectionState,
  InternalDomainProvenance,
} from "../../src/session-source/types";
import type { AnalysisOutcome, AnalysisRunStatus, SummarySource } from "../../src/summary/types";

export type OnboardingCount = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
};

export type OnboardingFinding = {
  readonly finalClass: string;
  readonly headline: string;

  readonly context: readonly string[];
  readonly counts: readonly OnboardingCount[];
  readonly surface: string;

  readonly confidenceBasis: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly summarySource: SummarySource;
};

export type EndedReason = "failed" | "no_candidates_passed_gate" | "no_sessions_to_analyse";

export type StagePersistedFacts = {
  readonly armedAt: Date | null;

  readonly retrievedAt: Date | null;

  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;
  readonly finding: OnboardingFinding | null;
};

export type RenderedStageState =
  | { readonly kind: "unarmed" }
  | { readonly kind: "leg1"; readonly elapsedSeconds: number }
  | { readonly kind: "leg2"; readonly elapsedSeconds: number }
  | {
      readonly kind: "finding";
      readonly elapsedSeconds: number;
      readonly finding: OnboardingFinding;
    }
  | { readonly kind: "ended"; readonly elapsedSeconds: number; readonly reason: EndedReason };

export type ReduceStage = (facts: StagePersistedFacts, nowMs: number) => RenderedStageState;

export type StageLogLine = {
  readonly atSeconds: number;

  readonly text: string;
};

export type StageView = {
  readonly heading: string;
  readonly hint: string;
  readonly lines: readonly StageLogLine[];
  readonly elapsedSeconds: number;
};

export type RenderStageView = (state: RenderedStageState) => StageView;

export type CounterRow = {
  readonly label: string;
  readonly value: number;
};

export type OnboardingCounterView = {
  readonly state: ConnectionState;
  readonly rows: readonly CounterRow[];
  readonly setAside: readonly CounterRow[];
  readonly identityUnverified: CounterRow;
  readonly asOfStatement: string;
  readonly windowStatement: string;
  readonly completenessStatement: string;
};

export type FindingCountLine = {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly surface: string;
  readonly sentence: string;
};

export type FindingView = {
  readonly classSentence: string;
  readonly headline: string;
  readonly contextLines: readonly string[];
  readonly counts: readonly FindingCountLine[];

  readonly confidenceSentence: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;

  readonly sourceSentence: string;
};

export type ToFindingView = (finding: OnboardingFinding) => FindingView;

export type StepState = "pending" | "active" | "done" | "skipped" | "coming-next";

export type StepId = "repo" | "analytics" | "slack" | "agent" | "moment";

export type FieldDescriptor = {
  readonly id: string;

  readonly label: string;

  readonly helper: string | null;

  readonly secret: boolean;

  readonly folded: boolean;

  readonly placeholder: string | null;

  readonly prefill: string | null;

  readonly refusalCodes: readonly ConnectRefusalCode[];
};

export type ActionDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly rank: "primary" | "secondary";
};

export type ConfirmationId = string;

export type StepDescriptor =
  | {
      readonly kind: "coming-next";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly whatItWillDo: string;
      readonly rail: "analytics" | "code" | "coding-assistant";
    }
  //   ^ no `fields`, no `actions`, no `confirmations`. There is nothing to
  //     render as a control. This absence IS the FR-O3/FR-O15 contract.
  | {
      readonly kind: "work";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly helper: string;
      readonly fields: readonly FieldDescriptor[];
      readonly actions: readonly ActionDescriptor[];
      readonly confirmations: readonly ConfirmationId[];
      readonly skippable: boolean;
    }
  | {
      readonly kind: "stage";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
    };

export type StepSequenceFacts = {
  readonly connectionStatus: ConnectionState["status"] | null;
  readonly slackConnected: boolean;

  readonly slackSkipped: boolean;

  readonly slackTestPostFailed: boolean;
  readonly armedAt: Date | null;

  readonly reopenedReadOnly: boolean;
};

export type StepView = {
  readonly id: StepId;
  readonly ordinal: number;
  readonly state: StepState;

  readonly open: boolean;

  readonly interactive: boolean;
};

export type DeriveStepStates = (facts: StepSequenceFacts) => readonly StepView[];

export type ReceiptLine = string;

export type PrivacyReceiptInput = {
  readonly inferredInternalDomain: string | null;
  readonly provenance: InternalDomainProvenance | null;
};

export type BuildPrivacyReceipt = (input: PrivacyReceiptInput) => readonly ReceiptLine[];

export type TestPostInput = {
  readonly result: PostResult;

  readonly channelId: string;

  // What the founder is shown, which is not the address (B-037).
  readonly channelLabel: string | null;
};

export type TestPostOutcome = {
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
};

export type DescribeTestPostOutcome = (input: TestPostInput) => TestPostOutcome;

export type FirstRunStatus = {
  readonly finding: OnboardingFinding | null;
  readonly armedAt: Date | null;
  readonly retrievedAt: Date | null;
  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;

  readonly counter: OnboardingCounterView;

  readonly channelId: string | null;
};
