import { z } from "zod";
import { request } from "@/services/workspace";
import {
  importPreviewSchema,
  datasetSchema,
  importSchema,
  importSummarySchema,
  importRowSchema,
  type ImportMapping,
  type Dataset,
} from "@/lib/import-contracts";

export const imports = {
  preview: (file: File, kind: Dataset, key: string) =>
    request(
      `imports/preview?${new URLSearchParams({ filename: file.name, kind })}`,
      importPreviewSchema,
      "POST",
      undefined,
      { file, key },
    ),
  list: (offset: number) =>
    request(`imports?offset=${offset}&limit=20`, z.array(importSummarySchema)),
  get: (id: string) => request(`imports/${id}`, importSchema),
  rows: (id: string, after: number) =>
    request(
      `imports/${id}/rows?after=${after}&limit=20`,
      z.array(importRowSchema),
    ),
  upload: (file: File, kind: Dataset, key: string) =>
    request(
      `imports?${new URLSearchParams({ filename: file.name, kind: datasetSchema.parse(kind) })}`,
      importSchema,
      "POST",
      undefined,
      { file, key },
    ),
  confirm: (id: string, body: ImportMapping) =>
    request(`imports/${id}/confirm`, importSchema, "POST", body),
  process: (id: string) =>
    request(`imports/${id}/process`, importSchema, "POST", {}),
  prepare: (id: string) =>
    request(`imports/${id}/prepare`, importSchema, "POST", {}),
  correct: (id: string, number: number, cells: string[]) =>
    request(`imports/${id}/rows/${number}`, importSchema, "PATCH", cells),
};
