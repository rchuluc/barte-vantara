"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useTenant } from "@/components/workspace-provider";
import { request } from "@/services/workspace";
import {
  businessUnitSchema,
  bankAccountSchema,
  type DestinationKind,
  type BusinessUnit,
  type BankAccount,
} from "@/lib/destination-contracts";

export function useUnits() {
  const { slug } = useTenant();

  return useQuery({
    queryKey: [slug, "business-units"],
    queryFn: () => request("business-units", z.array(businessUnitSchema)),
  });
}

export function useBankAccounts() {
  const { slug } = useTenant();

  return useQuery({
    queryKey: [slug, "bank-accounts"],
    queryFn: () => request("bank-accounts", z.array(bankAccountSchema)),
  });
}

export function useSaveDestination(kind: DestinationKind) {
  const { slug } = useTenant();
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) =>
      request<BusinessUnit | BankAccount>(
        id ? `${kind}/${id}` : kind,
        kind === "business-units" ? businessUnitSchema : bankAccountSchema,
        id ? "PATCH" : "POST",
        body,
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: [slug, kind] }),
        client.invalidateQueries({ queryKey: [slug, "me"] }),
      ]);
    },
  });
}
