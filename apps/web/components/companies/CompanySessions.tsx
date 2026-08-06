"use client";

import { useEffect, useState } from "react";

import { COMPANY_SESSIONS_UNREADABLE } from "@growthmind/shared";

import { CompanySessionsBody, type Load } from "@/components/companies/CompanySessionsBody";
import type { CompanySessionDTO } from "@/lib/companies/dto";

export function CompanySessions({ domain }: { readonly domain: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const abort = new AbortController();

    async function read(): Promise<void> {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(domain)}`, {
          signal: abort.signal,
        });

        if (response.status === 404) {
          setLoad({ state: "not_found" });
          return;
        }

        if (!response.ok) {
          setLoad({ state: "failed", message: COMPANY_SESSIONS_UNREADABLE });
          return;
        }

        const body = (await response.json()) as {
          sessions?: CompanySessionDTO[];
          truncated?: boolean;
        };

        setLoad({
          state: "ready",
          sessions: body.sessions ?? [],
          truncated: body.truncated === true,
        });
      } catch {
        if (abort.signal.aborted) return;
        setLoad({ state: "failed", message: COMPANY_SESSIONS_UNREADABLE });
      }
    }

    void read();
    return () => abort.abort();
  }, [domain]);

  return <CompanySessionsBody load={load} />;
}
