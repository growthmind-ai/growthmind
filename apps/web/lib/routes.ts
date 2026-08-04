export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",

  firstRun: "/first-run",

  // The work: the record, what it asks of you, and how it turned out. Listed here as their
  // literal segments so the "every route has a file behind it" guard covers them; build real
  // paths with the helpers in `paths`.
  findings: "/findings",
  findingDetail: "/findings/[id]",
  fixes: "/fixes",
  fixDetail: "/fixes/[id]",
  experiments: "/experiments",
  experimentDetail: "/experiments/[id]",

  // Standing reference about the customer's own product.
  audience: "/audience",
  plan: "/plan",
  agent: "/agent",
  data: "/data",

  // The account.
  channel: "/channel",
  account: "/account",
  settings: "/settings",
} as const;
