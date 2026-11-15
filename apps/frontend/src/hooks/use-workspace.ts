"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/components/workspace-provider";
import { workspace } from "@/services/workspace";
import {
  ApiError,
  type SigninInput,
  type CreateUser,
  type PatchUser,
} from "@/lib/contracts";

export function useMe() {
  const { slug } = useTenant();
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [slug, "me"],
    queryFn: () => workspace.me(),
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      client.clear();
      router.replace("/login");
    }
  }, [query.error, router, slug, client]);

  return query;
}

export function useSignin() {
  const { slug } = useTenant();
  const client = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: SigninInput) => workspace.signin(input),
    onSuccess: async (me) => {
      if ("requiresNewPassword" in me) return;
      await client.cancelQueries();
      client.clear();
      client.setQueryData([slug, "me"], me);
      router.replace("/dashboard");
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => workspace.logout(),
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      router.replace("/login");
    },
  });
}

export function useUsers(offset: number) {
  const { slug } = useTenant();

  return useQuery({
    queryKey: [slug, "users", offset],
    queryFn: () => workspace.users(offset),
  });
}

export function useRoles() {
  const { slug } = useTenant();

  return useQuery({
    queryKey: [slug, "roles"],
    queryFn: () => workspace.roles(),
  });
}

export function useSaveUser() {
  const { slug } = useTenant();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (
      input: { id: string; body: PatchUser } | { body: CreateUser },
    ) =>
      "id" in input
        ? workspace.update(input.id, input.body)
        : workspace.create(input.body),
    onSuccess: () => client.invalidateQueries({ queryKey: [slug, "users"] }),
  });
}

export function useDeactivateUser() {
  const { slug } = useTenant();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => workspace.deactivate(id),
    onSuccess: () => client.invalidateQueries({ queryKey: [slug, "users"] }),
  });
}
