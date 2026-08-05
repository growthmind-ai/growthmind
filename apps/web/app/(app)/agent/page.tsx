// The one Your-product surface that is real, and the only way to a key once setup is behind
// you: the onboarding surface is deliberately not linkable back to, so a founder who
// dismissed it — and every teammate who joined after it — arrives here instead.
import { Stack } from "@mantine/core";

import { createApiKeysRepo, createProviderInterestRepo } from "@growthmind/db";
import {
  agentProviderOrder,
  AGENT_PAGE_LEDE,
  AGENT_PAGE_TITLE,
  parseWebEnv,
  toAgentConnection,
} from "@growthmind/shared";

import { AgentConnectionLive } from "@/components/agent/AgentConnectionLive";
import { AgentPanel } from "@/components/first-run/AgentPanel";
import { AgentVision } from "@/components/preview/AgentVision";
import { PageHeader } from "@/components/ui/Page";
import { getDb } from "@/lib/db";
import { mcpPublicUrl } from "@/lib/mcp/public-url";
import { viewerMaySeePreview } from "@/lib/preview/guard";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const ctx = await requireTenantContext();

  const db = getDb();

  const [keyUse, noted, maySeePreview] = await Promise.all([
    createApiKeysRepo(db, ctx).liveKeyUse(),
    createProviderInterestRepo(db, ctx).listNotedProviders(),
    viewerMaySeePreview(),
  ]);

  // Read from the key rows on every visit rather than from anything the browser holds, so
  // a teammate landing after the fact sees the connected state and not an empty step.
  const connection = toAgentConnection(keyUse);

  return (
    <Stack gap="lg">
      <PageHeader title={AGENT_PAGE_TITLE}>{AGENT_PAGE_LEDE}</PageHeader>

      <AgentConnectionLive initial={connection}>
        <AgentPanel
          connection={connection}
          mcpUrl={mcpPublicUrl(parseWebEnv(process.env))}
          providerOrder={agentProviderOrder(noted)}
        />
      </AgentConnectionLive>

      {maySeePreview ? <AgentVision /> : null}
    </Stack>
  );
}
