import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, statusMessage, type Me } from "@/lib/contracts";
import {
  businessUnitSchema,
  bankAccountSchema,
  createUnitSchema,
  updateUnitSchema,
  createAccountSchema,
  updateAccountSchema,
} from "@/lib/destination-contracts";
import { backend } from "@/services/backend";

export async function destinationProxy(
  resource: string[],
  body: unknown,
  me: Me,
  options: { token: string; tenantId: string; method: string },
) {
  const path = resource.join("/");
  const unit = resource[0] === "business-units";
  const schema = unit ? businessUnitSchema : bankAccountSchema;
  let result: unknown;

  if (resource.length === 1 && options.method === "GET") {
    result = await backend(path, z.array(schema), options);
  } else {
    if (!me.permissions.includes("configure"))
      throw new ApiError(403, statusMessage(403));

    const create = resource.length === 1 && options.method === "POST";
    const update =
      resource.length === 2 &&
      z.uuid().safeParse(resource[1]).success &&
      options.method === "PATCH";
    if (!create && !update) throw new ApiError(404, statusMessage(404));

    const input = (
      unit
        ? create
          ? createUnitSchema
          : updateUnitSchema
        : create
          ? createAccountSchema
          : updateAccountSchema
    ).safeParse(body);
    if (!input.success) throw new ApiError(400, statusMessage(400));
    result = await backend<z.infer<typeof schema>>(path, schema, {
      ...options,
      body: input.data,
    });
  }

  return NextResponse.json(result, {
    status: options.method === "POST" ? 201 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
