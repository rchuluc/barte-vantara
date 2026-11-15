"use client";

import { createContext, useContext, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Tenant } from "@/lib/tenants";

type Branding = Pick<Tenant, "slug" | "name">;
const TenantContext = createContext<Branding | null>(null);

export function WorkspaceProvider({
  tenant,
  children,
}: {
  tenant: Branding;
  children: React.ReactNode;
}) {
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
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const tenant = useContext(TenantContext);

  if (!tenant) throw new Error("WorkspaceProvider is required");

  return tenant;
}
