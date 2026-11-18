"use client";

import { useEffect, useRef } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTenant, useImportDraft } from "@/components/workspace-provider";
import { imports } from "@/services/imports";
import type { Dataset, ImportJob, ImportMapping } from "@/lib/import-contracts";

export function useImports(offset: number) {
  const { slug } = useTenant();

  return useQuery({
    queryKey: [slug, "imports", "list", offset],
    queryFn: () => imports.list(offset),
  });
}

export function useImport(id: string) {
  const { slug } = useTenant();
  const { draft } = useImportDraft();

  return useQuery({
    queryKey: [slug, "imports", id],
    queryFn: () => imports.get(id),
    enabled: draft?.preview.id !== id,
    initialData: draft?.preview.id === id ? draft.preview : undefined,
  });
}

export function useImportRows(id: string, after: number) {
  const { slug } = useTenant();
  const { draft } = useImportDraft();

  return useQuery({
    queryKey: [slug, "imports", id, "rows", after],
    queryFn: () => imports.rows(id, after),
    enabled: draft?.preview.id !== id,
    initialData:
      draft?.preview.id === id
        ? draft.preview.rows.filter((row) => row.row_number > after)
        : undefined,
  });
}

export function usePreviewImport() {
  const { setDraft } = useImportDraft();

  return useMutation({
    gcTime: 0,
    mutationFn: ({
      file,
      kind,
      key,
    }: {
      file: File;
      kind: Dataset;
      key: string;
    }) => imports.preview(file, kind, key),
    onSuccess: (preview, { file }) =>
      setDraft({ file, preview, confirmed: false }),
  });
}

type ImportAction =
  | { action: "confirm"; mapping: ImportMapping }
  | { action: "prepare" }
  | { action: "correct"; number: number; cells: string[] };

export function useImportAction(id: string) {
  const { slug } = useTenant();
  const client = useQueryClient();
  const { draft, setDraft } = useImportDraft();

  return useMutation({
    mutationKey: [slug, "imports", id, "action"],
    gcTime: 0,
    mutationFn: async (input: ImportAction): Promise<ImportJob> => {
      if (input.action === "confirm") {
        if (draft?.preview.id === id) {
          setDraft({ ...draft, confirmed: true });
          await imports.upload(draft.file, draft.preview.dataset_kind, id);
        }

        return imports.confirm(id, input.mapping);
      }
      if (input.action === "correct")
        return imports.correct(id, input.number, input.cells);
      return imports[input.action](id);
    },
    onSuccess: (job) => {
      if (draft?.preview.id === id) setDraft(null);
      client.setQueryData([slug, "imports", id], job);
    },
    onSettled: () => client.invalidateQueries({ queryKey: [slug, "imports"] }),
  });
}

export function useLeaveImport(id: string) {
  const { slug } = useTenant();
  const { draft, setDraft } = useImportDraft();
  const client = useQueryClient();
  const router = useRouter();
  const busy =
    useIsMutating({ mutationKey: [slug, "imports", id, "action"] }) > 0;
  const unconfirmed = draft?.preview.id === id && !draft.confirmed;

  return {
    unconfirmed,
    busy,
    leave: () => {
      if (draft?.preview.id === id) {
        setDraft(null);
        client.removeQueries({ queryKey: [slug, "imports", id] });
      }
      router.push("/imports");
    },
  };
}

export function useProcessImport(job: ImportJob | undefined) {
  const { slug } = useTenant();
  const client = useQueryClient();
  const running = useRef(false);
  const processing = useMutation({
    mutationKey: [slug, "imports", job?.id, "process"],
    retry: false,
    mutationFn: async (current: ImportJob) => {
      await client.cancelQueries({
        queryKey: [slug, "imports", current.id],
        exact: true,
      });

      const next = await imports.process(current.id);

      if (next.state === "processing" && next.processed <= current.processed) {
        throw new Error(
          "Processing made no progress. Retry to resume this import.",
        );
      }

      return next;
    },
    onSuccess: (next) => {
      client.setQueryData([slug, "imports", next.id], next);
    },
    onSettled: (_data, _error, current) =>
      Promise.all([
        client.invalidateQueries({ queryKey: [slug, "imports", "list"] }),
        client.invalidateQueries({
          queryKey: [slug, "imports", current.id, "rows"],
        }),
      ]),
  });
  const { mutate, isPending, isError } = processing;

  useEffect(() => {
    if (
      job?.state === "processing" &&
      !isPending &&
      !isError &&
      !running.current
    ) {
      running.current = true;
      mutate(job, {
        onSettled: () => {
          running.current = false;
        },
      });
    }
  }, [job, isPending, isError, mutate]);

  return processing;
}
