import type { CredentialKey, CredentialKeyResolution } from "@growthmind/shared";
import { logger } from "@growthmind/shared";

// AD-20: every per-org port in this app (the delivery poster, the channel
// lister, the replay source) is built from a resolved credential key by a
// composition root. This is the one place that decides what "not resolved"
// logs and returns — callers supply only the domain phrase and the builder.
export function whenCredentialResolved<Ctx, Port>(
  resolution: CredentialKeyResolution,
  compositionRoot: string,
  cannotDo: string,
  fallback: Port,
  build: (key: CredentialKey) => (ctx: Ctx) => Promise<Port>,
): (ctx: Ctx) => Promise<Port> {
  if (!resolution.ok) {
    logger.error(
      `${compositionRoot}: the credential key could not be resolved (${resolution.reason}), ` +
        `so ${cannotDo} on this installation until it is configured`,
    );
    return () => Promise.resolve(fallback);
  }

  return build(resolution.key);
}
