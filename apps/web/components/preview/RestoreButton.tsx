import { Button } from "@mantine/core";

import { restoreFindingAction } from "@/lib/preview/actions";
import { tapTargetStyle } from "@/components/ui/tap-target";

export function RestoreButton({ id }: { readonly id: string }) {
  return (
    <form action={restoreFindingAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="subtle" size="compact-sm" style={tapTargetStyle}>
        Put it back
      </Button>
    </form>
  );
}
