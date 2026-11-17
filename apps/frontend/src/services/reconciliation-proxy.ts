import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, statusMessage } from "@/lib/contracts";
import {
  reconciliationSchema,
  reconciliationDetailSchema,
  matchInputSchema,
  matchReviewSchema,
  matchResultSchema,
} from "@/lib/reconciliation-contracts";
import { backend } from "@/services/backend";

export async function reconciliationProxy(
  request: NextRequest,
  resource: string[],
  body: unknown,
  options: { token: string; tenantId: string; method: string },
) {
  const path = resource.join("/");
  let result: unknown;

  if (resource.length === 1 && request.method === "GET") {
    result = await backend(path, reconciliationSchema, options);
  } else if (
    resource.length === 4 &&
    ["banks", "titles"].includes(resource[1]) &&
    z.uuid().safeParse(resource[2]).success &&
    resource[3] === "details" &&
    request.method === "GET"
  ) {
    result = await backend(path, reconciliationDetailSchema, options);
  } else if (
    resource.length === 2 &&
    z.uuid().safeParse(resource[1]).success &&
    request.method === "POST"
  ) {
    const parsed = matchInputSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, statusMessage(400));
    result = await backend(path, matchResultSchema, {
      ...options,
      body: parsed.data,
    });
  } else if (
    resource.length === 4 &&
    resource[1] === "decisions" &&
    z.uuid().safeParse(resource[2]).success &&
    resource[3] === "review" &&
    request.method === "POST"
  ) {
    const parsed = matchReviewSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, statusMessage(400));
    result = await backend(path, matchResultSchema, {
      ...options,
      body: parsed.data,
    });
  } else throw new ApiError(404, statusMessage(404));

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
