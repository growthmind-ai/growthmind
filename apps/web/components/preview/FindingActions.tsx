import { Button } from "@mantine/core";

import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { mintFixAction, readOutVerdictAction } from "@/lib/preview/actions";
import { fixPath, experimentPath } from "@/lib/paths";

import { DismissMenu } from "./DismissMenu";

interface FindingActionsProps {
  readonly id: string;
  readonly hasFix: boolean;
}

export function FixButton({ id, hasFix }: FindingActionsProps) {
  if (hasFix) {
    return (
      <ButtonLink href={fixPath(id)} size="compact-sm" style={tapTargetStyle}>
        See the fix you asked for
      </ButtonLink>
    );
  }

  return (
    <form action={mintFixAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="compact-sm" style={tapTargetStyle}>
        Get it fixed
      </Button>
    </form>
  );
}

/** The pair every finding carries: ask for the fix, or say it was not worth one. */
export function FindingActions({ id, hasFix }: FindingActionsProps) {
  return (
    <>
      <FixButton id={id} hasFix={hasFix} />
      <DismissMenu id={id} />
    </>
  );
}

export function VerdictButton({ id, readOut }: { readonly id: string; readonly readOut: boolean }) {
  if (readOut) {
    return (
      <ButtonLink href={experimentPath(id)} size="compact-sm" style={tapTargetStyle}>
        See the verdict →
      </ButtonLink>
    );
  }

  return (
    <form action={readOutVerdictAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="compact-sm" style={tapTargetStyle}>
        Read out the result
      </Button>
    </form>
  );
}
