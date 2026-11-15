import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backend } from "@/services/backend";
import { ApiError, statusMessage } from "@/lib/contracts";
import { tenantSchema } from "@/lib/tenant-schema";

const inputSchema = z
  .object({ tenant: tenantSchema, firstUserEmail: z.email().max(254) })
  .strict();

// The public frontend ingress forwards only this administrative operation.
// Backend GitHub OIDC validation is authoritative; browser cookies are ignored.
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 16384) {
      throw new ApiError(401, statusMessage(401));
    }
    const text = await request.text();
    if (text.length > 16384) throw new ApiError(400, statusMessage(400));
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, statusMessage(400));
    }
    const input = inputSchema.safeParse(body);
    if (!input.success) throw new ApiError(400, statusMessage(400));
    const tenant = await backend("admin/tenants", tenantSchema, {
      method: "POST",
      token: authorization.slice(7),
      body: input.data,
    });
    return NextResponse.json(tenant, { status: 201, headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return NextResponse.json(
      { message: statusMessage(status) },
      { status, headers },
    );
  }
}
