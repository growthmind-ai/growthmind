import { redirect } from "next/navigation";

import { StartInChannel } from "@/components/preview/StartInChannel";
import { readVerdicts } from "@/lib/preview/readers";
import { verdictPath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

export default function VerdictsPage() {
  const first = readVerdicts()[0];

  if (first !== undefined) {
    redirect(verdictPath(first.findingId));
  }

  return (
    <StartInChannel title="Nothing has been read out yet">
      A verdict appears here once a fix reaches its readout date.
    </StartInChannel>
  );
}
