import { redirect } from "next/navigation";

import { StartInChannel } from "@/components/preview/StartInChannel";
import { readFixes } from "@/lib/preview/readers";
import { fixPath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

export default function FixesPage() {
  const first = readFixes()[0];

  // One fix exists in the example content, so the tab goes straight to it rather than
  // offering a list of one — a list here would be the queue the product refuses to be.
  if (first !== undefined) {
    redirect(fixPath(first.findingId));
  }

  return (
    <StartInChannel title="Nothing has been sent to your agent yet">
      A fix appears here once you ask for one.
    </StartInChannel>
  );
}
