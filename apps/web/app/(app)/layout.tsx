import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { findMembershipsByUserId } from "@growthmind/db";

import { AppFrame } from "@/components/app/AppFrame";
import { navGroupsFor } from "@/lib/app-nav";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { viewerMaySeePreview } from "@/lib/preview/guard";
import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const tenant = await getTenantContext();
  if (tenant === null) {
    redirect(ROUTES.signIn);
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  const memberships = await findMembershipsByUserId(getDb(), tenant.userId);

  return (
    <AppFrame
      groups={navGroupsFor(await viewerMaySeePreview())}
      viewer={{
        name: session?.user.name ?? null,
        email: session?.user.email ?? null,
        organizationName: tenant.organizationName,
      }}
      organizations={memberships.map((membership) => ({
        id: membership.organizationId,
        name: membership.organizationName,
      }))}
      activeOrganizationId={tenant.organizationId}
      role={tenant.role}
    >
      {children}
    </AppFrame>
  );
}
