"use client";

import { Button } from "@mantine/core";
import Link from "next/link";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { AudienceCta } from "@/lib/audience/read";

import { NAME_WEBSITE_EVENT } from "./copy";
import { instrument } from "./instrument";

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
      onClick={() => instrument(NAME_WEBSITE_EVENT)}
    >
      {cta.label}
    </Button>
  );
}
