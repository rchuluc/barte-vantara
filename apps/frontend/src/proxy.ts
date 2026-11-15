import { NextRequest, NextResponse } from "next/server";
import { tenantByHost, tenantBySlug } from "@/lib/tenants";
import { tenantNotFoundRedirectUrl } from "@/lib/tenant-redirect";

export async function proxy(request: NextRequest) {
  const tenant = await tenantByHost(
    request.headers.get("host") ?? request.nextUrl.host,
  );

  const path = request.nextUrl.pathname;
  const pathTenant = await tenantBySlug(path.split("/")[1]);

  if (!tenant) {
    const redirectUrl = !pathTenant && tenantNotFoundRedirectUrl();

    return redirectUrl
      ? NextResponse.redirect(redirectUrl)
      : NextResponse.next();
  }

  if (pathTenant && pathTenant.slug !== tenant.slug) {
    const redirectUrl = tenantNotFoundRedirectUrl();

    if (redirectUrl) return NextResponse.redirect(redirectUrl);

    return new NextResponse("Workspace not found", { status: 404 });
  }

  if (pathTenant) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${tenant.slug}${path === "/" ? "/dashboard" : path}`;

  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
