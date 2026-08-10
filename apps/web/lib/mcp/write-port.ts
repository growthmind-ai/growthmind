import type { TenantContext } from "@growthmind/shared";

export interface ReportShippedCommand {
  readonly principal: TenantContext;

  readonly projectId: string | null;

  readonly page: string;

  readonly control: string | null;

  readonly description: string;

  readonly reportedAt: Date;
}

export interface ReportedChange {
  readonly changeId: string;
  readonly page: string;
  readonly control: string | null;
  readonly description: string;

  // The product's, computed from the results window at the moment the report lands.
  readonly readoutDueAt: Date;
}

export type ReportShippedAnswer =
  | { readonly outcome: "reported"; readonly change: ReportedChange }

  // The same change, told again inside its window: one row, one clock, and no second promise.
  | { readonly outcome: "clock_unchanged"; readonly change: ReportedChange }

  // Told again after a readout that could not measure anything. The same row goes back on the
  // clock with a new date, because nothing was answered the first time round.
  | { readonly outcome: "watching_again"; readonly change: ReportedChange }

  // Told again after it was answered. The change key is fixed at page and control, so there is
  // no second row to open and no date left to promise.
  | { readonly outcome: "already_answered"; readonly change: ReportedChange }
  | { readonly outcome: "stopped_watching"; readonly change: ReportedChange }
  | { readonly outcome: "no_project" }
  | { readonly outcome: "not_our_project" }
  | { readonly outcome: "ambiguous_project"; readonly projectIds: readonly string[] };

export interface McpWritePort {
  reportShipped(command: ReportShippedCommand): Promise<ReportShippedAnswer>;
}

export function createAbsentWritePort(log: (message: string) => void): McpWritePort {
  let announced = false;

  return {
    reportShipped(): Promise<ReportShippedAnswer> {
      if (!announced) {
        announced = true;
        log("mcp: nothing on this installation records what was shipped yet, so no report is kept");
      }

      return Promise.resolve({ outcome: "no_project" });
    },
  };
}
