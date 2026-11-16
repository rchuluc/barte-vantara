"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { usePreviewImport } from "@/hooks/use-imports";
import {
  MAX_IMPORT_BYTES,
  datasetLabels,
  type Dataset,
} from "@/lib/import-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RequestError } from "@/components/request-feedback";

export function ImportUpload({
  kinds,
  onUploaded,
}: {
  kinds: Dataset[];
  onUploaded: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Dataset>(kinds[0]);
  const [file, setFile] = useState<File>();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const upload = usePreviewImport();

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!upload.isPending) {
          setOpen(value);
          upload.reset();
          setFile(undefined);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!kinds.length}>
          <Upload data-icon="inline-start" />
          New import
        </Button>
      </DialogTrigger>
      <DialogContent className="import-workspace max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import financial data</DialogTitle>
          <DialogDescription>
            Preview your file and review its columns. Nothing is saved until you
            choose Confirm and import.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            upload.mutate(
              { file, kind, key },
              {
                onSuccess: (job) => {
                  setOpen(false);
                  setFile(undefined);
                  onUploaded(job.id);
                },
              },
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="dataset">Dataset</FieldLabel>
              <NativeSelect
                id="dataset"
                value={kind}
                disabled={upload.isPending}
                onChange={(event) => {
                  setKind(event.target.value as Dataset);
                  setKey(crypto.randomUUID());
                }}
              >
                {kinds.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {datasetLabels[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                Protheus and Omie are detected as receivables; Itaú as bank
                statements. This selection applies to other file formats.
              </FieldDescription>
            </Field>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="import-file">Source file</FieldLabel>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx"
                required
                disabled={upload.isPending}
                aria-invalid={!!error}
                aria-describedby="file-help file-error"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  setFile(undefined);
                  setError("");
                  setKey(crypto.randomUUID());
                  upload.reset();
                  if (!selected) return;
                  if (
                    !/\.(csv|xlsx)$/i.test(selected.name) ||
                    selected.name.length > 200 ||
                    selected.size === 0 ||
                    selected.size > MAX_IMPORT_BYTES
                  ) {
                    setError(
                      "Choose a nonempty CSV or XLSX file up to 100 MiB, with a filename of 200 characters or fewer.",
                    );
                    return;
                  }
                  setFile(selected);
                }}
              />
              <FieldDescription id="file-help">
                CSV or XLSX · up to 100 MiB. The first row must contain unique
                column names.
              </FieldDescription>
              <p
                id="file-error"
                role={error ? "alert" : undefined}
                className="text-sm text-destructive"
              >
                {error}
              </p>
            </Field>
          </FieldGroup>
          {upload.error && <RequestError error={upload.error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={!file || upload.isPending}>
              {upload.isPending ? "Reading file…" : "Preview file"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
