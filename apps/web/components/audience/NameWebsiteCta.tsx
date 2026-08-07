"use client";

import { Button } from "@mantine/core";
import Link from "next/link";
import posthog from "posthog-js";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { AudienceCta } from "@/lib/audience/read";

// Fired at the click, not the navigation: the settings page cannot know it was this empty
// state that sent the person there.
const CLICKED_EVENT = "Clicked 'name your website' from the empty audience page";

export interface NameWebsiteCtaProps {
  readonly cta: AudienceCta;
}

export function NameWebsiteCta({ cta }: NameWebsiteCtaProps) {
  return (
    <Button
      component={Link}
      href={cta.href}
      variant="default"
      size="compact-sm"
      style={tapTargetStyle}
      onClick={() => {
        // Self-hosted installs run without an analytics key; an uninitialised capture would
        // log a vendor warning instead of staying quiet.
        if (posthog.__loaded) posthog.capture(CLICKED_EVENT);
      }}
    >
      {cta.label}
    </Button>
  );
}
