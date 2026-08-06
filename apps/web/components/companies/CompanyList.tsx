"use client";

import { useEffect, useState } from "react";

import { COMPANY_LIST_UNREADABLE } from "@growthmind/shared";

import { CompanyListBody, type Load } from "@/components/companies/CompanyListBody";
import type { CompanyGroupDTO } from "@/lib/companies/dto";

export function CompanyList() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const abort = new AbortController();

    async function read(): Promise<void> {
      try {
        const response = await fetch("/api/companies", { signal: abort.signal });
        const body = (await response.json()) as {
          groups?: CompanyGroupDTO[];
          truncated?: boolean;
        };

        if (!response.ok) {
          setLoad({ state: "failed", message: COMPANY_LIST_UNREADABLE });
          return;
        }

        setLoad({
          state: "ready",
          groups: body.groups ?? [],
          truncated: body.truncated === true,
        });
      } catch {
        if (abort.signal.aborted) return;
        setLoad({ state: "failed", message: COMPANY_LIST_UNREADABLE });
      }
    }

    void read();
    return () => abort.abort();
  }, []);

  return <CompanyListBody load={load} />;
}
