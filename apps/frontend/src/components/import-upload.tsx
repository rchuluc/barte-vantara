"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { usePreviewImport } from "@/hooks/use-imports";
import { MAX_IMPORT_BYTES, type Dataset } from "@/lib/import-contracts";
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
  const t = useTranslations("imports");
  const c = useTranslations("ui");
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
          {t("newImport")}
        </Button>
      </DialogTrigger>
      <DialogContent className="import-workspace max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("uploadTitle")}</DialogTitle>
          <DialogDescription>{t("uploadDescription")}</DialogDescription>
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
              <FieldLabel htmlFor="dataset">{t("dataset")}</FieldLabel>
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
                    {t(`datasets.${value}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>{t("datasetHint")}</FieldDescription>
            </Field>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="import-file">{t("sourceFile")}</FieldLabel>
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
                    setError("fileValidation");
                    return;
                  }
                  setFile(selected);
                }}
              />
              <FieldDescription id="file-help">
                {t("fileHint")}
              </FieldDescription>
              <p
                id="file-error"
                role={error ? "alert" : undefined}
                className="text-sm text-destructive"
              >
                {error && t(error)}
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
              {c("cancel")}
            </Button>
            <Button disabled={!file || upload.isPending}>
              {upload.isPending ? t("readingFile") : t("previewFile")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
