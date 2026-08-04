import { redirect } from "next/navigation";

import { StartInChannel } from "@/components/preview/StartInChannel";
import { readChannel } from "@/lib/preview/readers";
import { evidencePath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

export default function EvidenceIndexPage() {
  // Step two of one finding's story, so the tab follows the finding the channel leads
  // with rather than offering a list — the ledger on /seen is the list.
  const lead = readChannel().messages.find((message) => message.findingId !== null);

  if (lead !== undefined && lead.findingId !== null) {
    redirect(evidencePath(lead.findingId));
  }

  return (
    <StartInChannel title="No finding is open">Evidence sits behind a finding.</StartInChannel>
  );
}
