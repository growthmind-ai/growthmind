import type { TestDb } from "../../src/testing";

// B-042's fault injector, relocated from first-run-status.service.test.ts so the O-051
// close-cannot-throw case can import it instead of minting a second one (.ai/PATTERNS.md).
export const failTableReads = (realDb: TestDb, table: unknown, thrown: Error): TestDb =>
  new Proxy(realDb, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "select") {
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      }
      return (...args: unknown[]) => {
        const builder = (value as (...a: unknown[]) => unknown).apply(target, args) as Record<
          string,
          unknown
        >;
        return new Proxy(builder, {
          get(bt, bp, br) {
            const member = Reflect.get(bt, bp, br);
            if (bp !== "from") {
              return typeof member === "function"
                ? (member as (...a: unknown[]) => unknown).bind(bt)
                : member;
            }
            return (t: unknown) => {
              if (t === table) throw thrown;
              return (member as (t: unknown) => unknown).call(bt, t);
            };
          },
        });
      };
    },
  });
