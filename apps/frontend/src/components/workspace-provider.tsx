"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { Tenant } from "@/lib/tenants";
import type { ImportDraft } from "@/lib/import-contracts";

type Branding = Pick<Tenant, "slug" | "name">;
const TenantContext = createContext<Branding | null>(null);
const ImportDraftContext = createContext<{
  draft: ImportDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<ImportDraft | null>>;
} | null>(null);

export function WorkspaceProvider({
  tenant,
  children,
}: {
  tenant: Branding;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const hasDraft = draft !== null;

  useEffect(() => {
    if (!hasDraft) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);

    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasDraft]);

  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30000 },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <TenantContext.Provider value={tenant}>
      <QueryClientProvider client={client}>
        <ImportDraftContext.Provider value={{ draft, setDraft }}>
          {children}
        </ImportDraftContext.Provider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </TenantContext.Provider>
  );
}

export function useImportDraft() {
  const context = useContext(ImportDraftContext);

  if (!context) throw new Error("WorkspaceProvider is required");

  return context;
}

export function useTenant() {
  const tenant = useContext(TenantContext);

  if (!tenant) throw new Error("WorkspaceProvider is required");

  return tenant;
}
