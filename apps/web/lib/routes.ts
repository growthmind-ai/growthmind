export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",

  firstRun: "/first-run",

  settings: "/settings",

  // The preview surfaces. Listed here as their literal segments so the "every route has a
  // file behind it" guard covers them; build real paths with the helpers in `preview/tabs`.
  seen: "/seen",
  evidence: "/evidence",
  evidenceDetail: "/evidence/[id]",
  channel: "/channel",
  audience: "/audience",
  plan: "/plan",
  fixes: "/fixes",
  fixDetail: "/fixes/[id]",
  agent: "/agent",
  verdicts: "/verdicts",
  verdictDetail: "/verdicts/[id]",
  collect: "/collect",
} as const;
