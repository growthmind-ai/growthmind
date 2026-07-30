// Cross-boundary route path constants (ADD D-G/D9, mirroring
// `worker/src/task-names.ts`'s exported-constants convention). Every
// consumer imports ROUTES rather than retyping a path string, so a typo
// becomes a compile error instead of a silent dead redirect.
export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
} as const;
