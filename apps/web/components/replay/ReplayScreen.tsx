"use client";

import { Stack } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";

import type { ReplayFilters } from "@growthmind/shared";

import { LoadingSkeletonStack } from "@/components/ui/LoadingSkeletonStack";

import { FilterBar } from "./filters/FilterBar";
import { nextReplayUrl, replayFilterValue, replayFiltersWith } from "./filters/filter-url";
import type { FilterDescriptor } from "./filters/types";

interface ReplayScreenProps {
  readonly descriptors: readonly FilterDescriptor[];
  readonly filters: ReplayFilters;
  readonly label: string;
  readonly children: ReactNode;
}

interface Change {
  readonly param: string;
  readonly value: string | null;
}

// The list is server-rendered and arrives as children, so a pasted filtered URL paints the
// filtered state on the first byte. What this shell owns is the frame between a click and the
// navigation resolving: the pill accents from the optimistic value, the URL is written in the
// same tick, and the skeletons stand in for the rows that are on their way.
export function ReplayScreen({ descriptors, filters, label, children }: ReplayScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [shown, apply] = useOptimistic(filters, (current: ReplayFilters, pick: Change) =>
    replayFiltersWith(current, pick.param, pick.value),
  );

  function change(param: string, value: string | null): void {
    // Computed against what is already shown, so a second click on the same option has no URL
    // to push and stacks no second history entry.
    const url = nextReplayUrl(shown, param, value);
    if (url === null) return;

    startTransition(() => {
      apply({ param, value });
      router.push(url, { scroll: false });
    });
  }

  const painted = descriptors.map((descriptor) => ({
    ...descriptor,
    value: replayFilterValue(shown, descriptor.param),
  }));

  return (
    <Stack gap="sm">
      <FilterBar
        descriptors={painted}
        label={label}
        onApply={(param, value) => {
          change(param, value);
        }}
        onClear={(param) => {
          change(param, null);
        }}
      />

      {pending ? <LoadingSkeletonStack /> : children}
    </Stack>
  );
}
