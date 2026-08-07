"use client";

import { Stack } from "@mantine/core";
import { useEffect, useState } from "react";

import { DeliveryCard } from "./DeliveryCard";
import type { DeliveryCardView } from "./view";

// `touched: false` means the data decides, which is how a failure is open on arrival and how
// returning to this URL paints the same picture rather than a remembered one. The first
// interaction hands the choice to the reader, one receipt at a time.
type Disclosure =
  { readonly touched: false } | { readonly touched: true; readonly openId: string | null };

interface DeliveryRecordProps {
  readonly cards: readonly DeliveryCardView[];
  readonly deepLinkId: string | null;
}

export function DeliveryRecord({ cards, deepLinkId }: DeliveryRecordProps) {
  const [disclosure, setDisclosure] = useState<Disclosure>(
    deepLinkId === null ? { touched: false } : { touched: true, openId: deepLinkId },
  );

  useEffect(() => {
    if (deepLinkId === null) return;
    // Not smooth: a resumed state must not replay as though it had just happened.
    document.getElementById(deepLinkId)?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [deepLinkId]);

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDisclosure({ touched: true, openId: null });
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);

  const openByData = cards.find((card) => card.openOnPaint)?.id ?? null;
  const openId = disclosure.touched ? disclosure.openId : openByData;

  return (
    <Stack gap="md">
      {cards.map((card) => (
        <DeliveryCard
          key={card.id}
          card={card}
          open={disclosure.touched ? card.id === openId : card.openOnPaint}
          onToggle={() => {
            setDisclosure({ touched: true, openId: openId === card.id ? null : card.id });
          }}
        />
      ))}
    </Stack>
  );
}
