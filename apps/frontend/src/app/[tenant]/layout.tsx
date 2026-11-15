import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { tenantBySlug, brandForeground } from "@/lib/tenants";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { tenantNotFoundRedirectUrl } from "@/lib/tenant-redirect";

export const dynamic = "force-dynamic";

function missingTenant(): never {
  const url = tenantNotFoundRedirectUrl();

  if (url) redirect(url);

  notFound();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const tenant = await tenantBySlug((await params).tenant);

  if (!tenant) missingTenant();

  return { title: tenant.name, description: `${tenant.name} workspace` };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const tenant = await tenantBySlug((await params).tenant);

  if (!tenant) missingTenant();

  return (
    <div
      style={
        {
          "--primary": tenant.primary,
          "--primary-foreground": brandForeground(tenant.primary),
        } as CSSProperties
      }
    >
      <WorkspaceProvider
        key={tenant.slug}
        tenant={{ slug: tenant.slug, name: tenant.name }}
      >
        {children}
      </WorkspaceProvider>
    </div>
  );
}
