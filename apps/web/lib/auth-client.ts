import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// baseURL intentionally left to Better Auth's default (same-origin). There is only ever
// one deployment target per environment (self-host or this app's own origin), so no
// explicit override is needed here.
const authClient = createAuthClient({
  plugins: [organizationClient()],
});

// Bindings the sign-up/sign-in forms and the sign-out button consume in a later wave
// (`apps/web` table). Re-exported individually rather than the whole client so call
// sites import exactly what they use.
export const { signIn, signUp, signOut, useSession } = authClient;
