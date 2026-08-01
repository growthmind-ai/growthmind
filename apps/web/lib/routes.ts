// Cross-boundary route path constants (ADD D-G/D9, mirroring
// `worker/src/task-names.ts`'s exported-constants convention). Every
// consumer imports ROUTES rather than retyping a path string, so a typo
// becomes a compile error instead of a silent dead redirect.
export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  /**
   * The first-run surface (O-008 AD-17). Its page lives in a ROUTE GROUP —
   * `app/(first-run)/first-run/page.tsx` — so the surface can carry its own
   * layout without a URL segment; the group's parentheses never appear in the
   * address, which is exactly the shape a hand-checked "the folder is there"
   * review gets wrong in both directions.
   *
   * THIS IS THE ONE HOME FOR THE STRING. `apps/web/__tests__/routes.test.ts`
   * asserts the literal appears nowhere else under `apps/web` outside the
   * surface's own tree, and `first-run-constraints.test.ts` asserts nothing
   * links back to it after completion (deviation 1) — two scans, one literal,
   * and this line is what both point at.
   */
  firstRun: "/first-run",
} as const;
