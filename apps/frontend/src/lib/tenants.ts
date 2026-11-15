import { z } from "zod";
import { tenantSchema, type Tenant } from "@/lib/tenant-schema";
import { backend } from "@/services/backend";

export type { Tenant } from "@/lib/tenant-schema";

// Deployment configuration, not authorization. IDs must match finance.tenant.
// Keep this module in server components, route handlers and proxy only.
export async function tenants(): Promise<Tenant[]> {
  const result = await backend("tenants", z.array(tenantSchema));
  const slugs = result.map((tenant) => tenant.slug);
  const domains = result.flatMap((tenant) => tenant.domains);

  if (
    new Set(slugs).size !== slugs.length ||
    new Set(domains).size !== domains.length
  ) {
    throw new Error("Tenant slugs and domains must be unique");
  }

  return result;
}

export async function tenantBySlug(slug: string): Promise<Tenant | undefined> {
  return (await tenants()).find((tenant) => tenant.slug === slug);
}

export async function tenantByHost(host: string): Promise<Tenant | undefined> {
  const hostname = host.toLowerCase().split(":")[0];

  return (await tenants()).find((tenant) => tenant.domains.includes(hostname));
}

export function brandForeground(hex: string): string {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;

  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}
