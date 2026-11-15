import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantByHost, tenantBySlug } from "@/lib/tenants";
import { backend } from "@/services/backend";
import {
  ApiError,
  statusMessage,
  signinSchema,
  newPasswordSchema,
  createUserSchema,
  patchUserSchema,
  meSchema,
  userSchema,
  rolesSchema,
} from "@/lib/contracts";

type Context = { params: Promise<{ tenant: string; resource: string[] }> };
const tokensSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive().max(86400),
});
const challengeSchema = z.object({
  challenge: z.literal("NEW_PASSWORD_REQUIRED"),
  session: z.string().min(1).max(2048),
});
const pendingSchema = z.object({
  email: z.email(),
  session: z.string().min(1).max(2048),
});

async function handle(request: NextRequest, context: Context) {
  const { tenant: slug, resource } = await context.params;
  const cookieName = `vantara-${slug}`;
  const challengeCookie = `${cookieName}-challenge`;
  const noStore = { "Cache-Control": "no-store" };

  try {
    const tenant = await tenantBySlug(slug);
    const hostTenant = await tenantByHost(
      request.headers.get("host") ?? request.nextUrl.host,
    );

    if (!tenant || (hostTenant && hostTenant.slug !== slug))
      throw new ApiError(404, statusMessage(404));

    const method = request.method;

    // Next may reconstruct the internal URL using its bind address. The browser
    // Origin must match the request authority, not that internal hostname.
    const origin = `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;

    if (method !== "GET" && request.headers.get("origin") !== origin) {
      throw new ApiError(403, statusMessage(403));
    }

    const path = resource.join("/");

    if (method === "POST" && path === "logout") {
      const response = new NextResponse(null, {
        status: 204,
        headers: noStore,
      });
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      response.cookies.set(challengeCookie, "", { path: "/", maxAge: 0 });

      return response;
    }

    let body: unknown;

    if (method === "POST" || method === "PATCH") {
      const text = await request.text();

      if (text.length > 32768) throw new ApiError(400, statusMessage(400));

      try {
        body = JSON.parse(text);
      } catch {
        throw new ApiError(400, statusMessage(400));
      }
    }

    if (
      method === "POST" &&
      (path === "signin" || path === "signin/password")
    ) {
      let authBody: {
        email: string;
        password?: string;
        session?: string;
        newPassword?: string;
      };
      if (path === "signin") {
        const input = signinSchema.safeParse(body);
        if (!input.success) throw new ApiError(400, statusMessage(400));
        authBody = input.data;
      } else {
        const input = newPasswordSchema.safeParse(body);
        if (!input.success) throw new ApiError(400, statusMessage(400));
        let pending: z.infer<typeof pendingSchema>;
        try {
          pending = pendingSchema.parse(
            JSON.parse(request.cookies.get(challengeCookie)?.value ?? "null"),
          );
        } catch {
          throw new ApiError(401, statusMessage(401));
        }
        authBody = { ...pending, ...input.data };
      }

      const tokens = await backend(
        path,
        z.union([tokensSchema, challengeSchema]),
        {
          method,
          body: authBody,
        },
      );
      if ("challenge" in tokens) {
        const response = NextResponse.json(
          { requiresNewPassword: true },
          { headers: noStore },
        );
        response.cookies.set(
          challengeCookie,
          JSON.stringify({ email: authBody.email, session: tokens.session }),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 180,
          },
        );
        response.cookies.set(cookieName, "", { path: "/", maxAge: 0 });
        return response;
      }
      const me = await backend("me", meSchema, {
        token: tokens.accessToken,
        tenantId: tenant.id,
      });

      if (me.tenant_id !== tenant.id || !me.active)
        throw new ApiError(403, statusMessage(403));

      const response = NextResponse.json(me, { headers: noStore });
      response.cookies.set(cookieName, tokens.accessToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: tokens.expiresIn,
      });
      response.cookies.set(challengeCookie, "", { path: "/", maxAge: 0 });

      return response;
    }

    const token = request.cookies.get(cookieName)?.value;

    if (!token) throw new ApiError(401, statusMessage(401));

    const options = { token, tenantId: tenant.id, method };
    const me = await backend(
      "me",
      meSchema,
      options.method === "GET" ? options : { ...options, method: "GET" },
    );

    if (me.tenant_id !== tenant.id || !me.active)
      throw new ApiError(403, statusMessage(403));
    if (path === "me" && method === "GET")
      return NextResponse.json(me, { headers: noStore });
    if (!me.permissions.includes("configure"))
      throw new ApiError(403, statusMessage(403));

    let result: unknown;

    if (method === "GET" && path === "users/roles") {
      result = await backend(path, rolesSchema, options);
    } else if (method === "GET" && path === "users") {
      const offset = request.nextUrl.searchParams.get("offset") ?? "0";
      const limit = request.nextUrl.searchParams.get("limit") ?? "20";

      if (
        !/^\d{1,7}$/.test(offset) ||
        !/^\d{1,3}$/.test(limit) ||
        Number(limit) < 1 ||
        Number(limit) > 100
      )
        throw new ApiError(400, statusMessage(400));

      result = await backend(
        `users?offset=${offset}&limit=${limit}`,
        z.array(userSchema),
        options,
      );
    } else if (method === "POST" && path === "users") {
      const input = createUserSchema.safeParse(body);

      if (!input.success) throw new ApiError(400, statusMessage(400));

      result = await backend(path, userSchema, {
        ...options,
        body: input.data,
      });
    } else if (
      resource.length === 2 &&
      resource[0] === "users" &&
      z.uuid().safeParse(resource[1]).success &&
      (method === "PATCH" || method === "DELETE")
    ) {
      if (resource[1] === me.id) throw new ApiError(403, statusMessage(403));

      if (method === "DELETE") {
        await backend(path, z.null(), options);

        return new NextResponse(null, { status: 204, headers: noStore });
      }

      const input = patchUserSchema.safeParse(body);

      if (!input.success) throw new ApiError(400, statusMessage(400));

      result = await backend(path, userSchema, {
        ...options,
        body: input.data,
      });
    } else {
      throw new ApiError(404, statusMessage(404));
    }

    return NextResponse.json(result, {
      status: method === "POST" ? 201 : 200,
      headers: noStore,
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    const response = NextResponse.json(
      { message: statusMessage(status) },
      { status, headers: noStore },
    );

    if (status === 401)
      response.cookies.set(cookieName, "", { path: "/", maxAge: 0 });

    return response;
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
