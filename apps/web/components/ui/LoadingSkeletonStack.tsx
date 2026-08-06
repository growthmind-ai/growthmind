import { Skeleton, Stack } from "@mantine/core";

const DEFAULT_ROW_COUNT = 2;
const DEFAULT_ROW_HEIGHT = 72;

interface LoadingSkeletonStackProps {
  readonly count?: number;
  readonly height?: number;
}

/** The fixed-height skeleton-row placeholder shared by every list body's loading state. */
export function LoadingSkeletonStack({
  count = DEFAULT_ROW_COUNT,
  height = DEFAULT_ROW_HEIGHT,
}: LoadingSkeletonStackProps) {
  return (
    <Stack gap="sm">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={height} radius="md" />
      ))}
    </Stack>
  );
}
