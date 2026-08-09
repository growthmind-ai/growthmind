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
