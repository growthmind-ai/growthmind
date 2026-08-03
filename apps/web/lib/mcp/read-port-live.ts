import type { ScopedDb } from "@growthmind/db";

import type {
  FindingRecord,
  FixRecord,
  GetFindingQuery,
  GetFixQuery,
  ListOpenFixesQuery,
  McpReadPort,
  OpenFixPage,
} from "./read-port";

const NOT_IMPLEMENTED = "mcp live read port: not implemented";

export function createLiveReadPort(db: ScopedDb): McpReadPort {
  void db;

  return {
    listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage> {
      void query;
      throw new Error(NOT_IMPLEMENTED);
    },

    getFix(query: GetFixQuery): Promise<FixRecord | null> {
      void query;
      throw new Error(NOT_IMPLEMENTED);
    },

    getFinding(query: GetFindingQuery): Promise<FindingRecord | null> {
      void query;
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
