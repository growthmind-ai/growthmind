import type { RecordingNarrator } from "@growthmind/adapters";

export interface ConfiguredNarrator {
  readonly port: RecordingNarrator;

  readonly resolvedModelId: string;
}
