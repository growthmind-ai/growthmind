import type { TestDb } from "@growthmind/db/testing";

/**
 * Runs `read` with one table renamed out from under it, so a reader fails the way it fails in
 * production: at the driver, on one table, while every other read on the same page still
 * answers. A stubbed repository proves the branch exists; only this proves it is the branch
 * a real failure reaches.
 */
export async function parkTable<T>(db: TestDb, table: string, read: () => Promise<T>): Promise<T> {
  await db.$client.exec(`alter table ${table} rename to ${table}_parked`);
  try {
    return await read();
  } finally {
    await db.$client.exec(`alter table ${table}_parked rename to ${table}`);
  }
}
