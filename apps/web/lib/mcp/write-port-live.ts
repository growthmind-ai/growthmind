import { createProjectsRepo, createShippedChangesService, type ScopedDb } from "@growthmind/db";
import { NO_CONTROL_LABEL } from "@growthmind/shared";

import type {
  McpWritePort,
  ReportShippedAnswer,
  ReportShippedCommand,
  ReportedChange,
} from "./write-port";

export function createLiveWritePort(db: ScopedDb): McpWritePort {
  return {
    async reportShipped(command: ReportShippedCommand): Promise<ReportShippedAnswer> {
      const resolved = await resolveProject(db, command);
      if (resolved.outcome !== "answered") {
        return resolved;
      }

      const result = await createShippedChangesService(db, command.principal).reportShipped({
        projectId: resolved.projectId,
        page: command.page,
        description: command.description,
        reportedAt: command.reportedAt,
        ...(command.control === null ? {} : { control: command.control }),
      });

      return { outcome: result.claim, change: reported(result.change) };
    },
  };
}

type ReportedRow = Awaited<
  ReturnType<ReturnType<typeof createShippedChangesService>["reportShipped"]>
>["change"];

function reported(change: ReportedRow): ReportedChange {
  return {
    changeId: change.id,
    page: change.page,
    control: change.controlLabel === NO_CONTROL_LABEL ? null : change.controlLabel,
    description: change.description,
    readoutDueAt: change.readoutDueAt,
  };
}

type ProjectResolution =
  | { readonly outcome: "answered"; readonly projectId: string }
  | { readonly outcome: "no_project" }
  | { readonly outcome: "not_our_project" }
  | { readonly outcome: "ambiguous_project"; readonly projectIds: readonly string[] };

// The org-scoped list is the whole boundary: an id the caller supplied is only ever accepted
// when it is already in it, so another organization's id is unreachable before any write and
// the repository's own ownership guard is the second belt rather than the first.
async function resolveProject(
  db: ScopedDb,
  command: ReportShippedCommand,
): Promise<ProjectResolution> {
  const projects = await createProjectsRepo(db, command.principal).list();

  if (command.projectId !== null) {
    const owned = projects.find((project) => project.id === command.projectId);
    return owned === undefined
      ? { outcome: "not_our_project" }
      : { outcome: "answered", projectId: owned.id };
  }

  const [only] = projects;
  if (only === undefined) {
    return { outcome: "no_project" };
  }

  return projects.length === 1
    ? { outcome: "answered", projectId: only.id }
    : { outcome: "ambiguous_project", projectIds: projects.map((project) => project.id) };
}
