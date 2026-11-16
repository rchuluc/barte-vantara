import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError, meSchema, statusMessage } from "@/lib/contracts";
import { tenantByHost } from "@/lib/tenants";
import { backend } from "@/services/backend";

let keys: ReturnType<typeof createRemoteJWKSet> | undefined;
let keysIssuer: string | undefined;

export async function mcpContext(request: Request) {
  const issuer = process.env.COGNITO_ISSUER?.trim();
  const clientId = process.env.COGNITO_MCP_CLIENT_ID?.trim();
  if (!issuer || !clientId || new URL(issuer).protocol !== "https:")
    throw new ApiError(503, statusMessage(503));

  const url = new URL(request.url);
  const host = (request.headers.get("host") ?? url.host).toLowerCase();
  if (!/^[a-z\d.-]+(?::\d{1,5})?$/.test(host))
    throw new ApiError(400, statusMessage(400));
  const tenant = await tenantByHost(host);
  if (!tenant) throw new ApiError(404, statusMessage(404));

  const origin = `${process.env.NODE_ENV === "production" ? "https:" : url.protocol}//${host}`;
  return { issuer, clientId, tenant, origin, resource: `${origin}/api/mcp` };
}

export async function authenticateMcp(
  request: Request,
  context: Awaited<ReturnType<typeof mcpContext>>,
) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 16384)
    throw new ApiError(401, statusMessage(401));

  if (!keys || keysIssuer !== context.issuer) {
    keys = createRemoteJWKSet(
      new URL(`${context.issuer}/.well-known/jwks.json`),
      { timeoutDuration: 5000 },
    );
    keysIssuer = context.issuer;
  }

  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: context.issuer,
      audience: context.resource,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "client_id", "token_use"],
    });
    if (
      payload.client_id !== context.clientId ||
      payload.token_use !== "access" ||
      payload.aud !== context.resource ||
      !payload.sub?.trim() ||
      typeof payload.scope !== "string" ||
      !payload.scope.split(" ").includes("openid")
    )
      throw new Error("Invalid delegated access token");
  } catch {
    throw new ApiError(401, statusMessage(401));
  }

  const options = { token, tenantId: context.tenant.id };
  // Resolve current database roles/scopes, never accept authority from tool input.
  const me = await backend("me", meSchema, options);
  if (!me.active || me.tenant_id !== context.tenant.id || me.actorKind !== "ai")
    throw new ApiError(403, statusMessage(403));

  return { me, options };
}

export function mcpError(error: unknown, origin?: string) {
  const status = error instanceof ApiError ? error.status : 503;
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (status === 401 && origin)
    headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="openid"`,
    );
  return Response.json({ message: statusMessage(status) }, { status, headers });
}

export async function mcpMetadata(request: Request) {
  try {
    const { issuer, resource } = await mcpContext(request);
    return Response.json(
      {
        resource,
        authorization_servers: [issuer],
        scopes_supported: ["openid", "email"],
        bearer_methods_supported: ["header"],
        resource_name: "Vantara imports",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mcpError(error);
  }
}
