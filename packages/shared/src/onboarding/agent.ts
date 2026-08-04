import { z } from "zod";

import { agentProviderIdSchema } from "./agent-blocks";

export const agentConnectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("waiting") }),
  z.object({ kind: z.literal("connected") }),
]);

export type AgentConnection = z.infer<typeof agentConnectionSchema>;

export interface ApiKeyUseSummary {
  readonly liveCount: number;
  readonly anyUsed: boolean;
}

// The zero-live branch comes first: a revoked key is not a key, so an org whose
// only used key was revoked reads none rather than connected.
export function toAgentConnection(use: ApiKeyUseSummary): AgentConnection {
  if (use.liveCount === 0) return { kind: "none" };

  return use.anyUsed ? { kind: "connected" } : { kind: "waiting" };
}

export const firstRunAgentMintInputSchema = z.strictObject({
  provider: agentProviderIdSchema,
});

export type FirstRunAgentMintInput = z.infer<typeof firstRunAgentMintInputSchema>;
