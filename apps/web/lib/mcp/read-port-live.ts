import { createFixesService, type ScopedDb } from "@growthmind/db";

import { toFindingRecord, toFixRecord, toOpenFixRow } from "./dto";
import type {
  FindingRecord,
  FixRecord,
  GetFindingQuery,
  GetFixQuery,
  ListOpenFixesQuery,
  McpReadPort,
  OpenFixPage,
} from "./read-port";

export function createLiveReadPort(db: ScopedDb): McpReadPort {
  return {
    async listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage> {
      const page = await createFixesService(db, query.principal).listOpen({
        projectId: query.projectId,
        limit: query.limit,
      });

      return { fixes: page.rows.map(toOpenFixRow), totalOpen: page.totalOpen };
    },

    async getFix(query: GetFixQuery): Promise<FixRecord | null> {
      const read = await createFixesService(db, query.principal).readFix(query.fixId);
      if (read === null) {
        return null;
      }

      return toFixRecord({
        fixId: read.fix.id,
        findingId: read.fix.findingId,
        status: read.fix.status,
        spec: read.spec,
        attempt: read.fix.attempt,
        alreadyLanded: read.fix.alreadyLanded,
        impact: read.impact,
        resultsBy: read.fix.resultsBy,
      });
    },

    // A finding with no derivable observation reads back as null here, so the answer is the
    // typed not-found rather than a schema throw the caller would see as a fault.
    async getFinding(query: GetFindingQuery): Promise<FindingRecord | null> {
      const read = await createFixesService(db, query.principal).readFinding(query.findingId);

      return read === null ? null : toFindingRecord(read);
    },
  };
}
