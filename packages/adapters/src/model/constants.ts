// The `eu.` prefix is a cross-region inference profile, not decoration: the bare
// `anthropic.*` id rejects on-demand invocation, and a `us.`-prefixed one does not
// resolve from a European region. Override with GROWTHMIND_COLDSTART_MODEL when
// AWS_REGION is outside the EU group.
export const DEFAULT_COLDSTART_MODEL = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

export const MODEL_REQUEST_TIMEOUT_MS = 30_000;

export const MODEL_CALL_MAX_RETRIES = 0;

export const CANDIDATE_DATA_DELIMITER = "<<<GROWTHMIND_CANDIDATE_DATA>>>";
