"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import {
  useImport,
  useImportAction,
  useProcessImport,
  useLeaveImport,
} from "@/hooks/use-imports";
import { ApiError } from "@/lib/contracts";
import { ImportMappingForm } from "@/components/import-mapping";
import { ImportRows } from "@/components/import-rows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Loading, RequestError } from "@/components/request-feedback";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function ImportDetail({ id }: { id: string }) {
  const t = useTranslations("imports");
  const format = useFormatter();
  const query = useImport(id);
  const action = useImportAction(id);
  const job = query.data;
  const processing = useProcessImport(job);
  const departure = useLeaveImport(id);
  const [leaving, setLeaving] = useState(false);

  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <Alert className="import-workspace">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>
          <p>{t("unavailableDescription")}</p>
          <Button onClick={departure.leave}>{t("returnToImports")}</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="import-workspace flex flex-col gap-8">
      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            className="self-start"
            disabled={departure.busy}
          >
            <ArrowLeft data-icon="inline-start" />
            {t("allImports")}
          </Button>
        </DialogTrigger>
        <DialogContent className="import-workspace">
          <DialogHeader>
            <DialogTitle>
              {departure.unconfirmed
                ? t("discardQuestion")
                : t("leaveQuestion")}
            </DialogTitle>
            <DialogDescription>
              {departure.unconfirmed
                ? t("discardDescription")
                : t("leaveDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>
              {t("stay")}
            </Button>
            <Button
              variant={departure.unconfirmed ? "destructive" : "default"}
              onClick={departure.leave}
            >
              {departure.unconfirmed ? t("discard") : t("backToImports")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {query.error ? (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : !job ? (
        <Loading />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {t(`datasets.${job.dataset_kind}`)} ·{" "}
                {job.platform ?? t("detectingFormat")}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight break-all">
                {job.filename}
              </h1>
            </div>
            <Badge
              variant={job.state === "failed" ? "destructive" : "secondary"}
            >
              {t(`states.${job.state}`)}
            </Badge>
          </header>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [t("sourceRecords"), job.total],
              [t("accepted"), job.processed - job.rejected],
              [t("needsCorrection"), job.rejected],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">
                    {format.number(Number(value))}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          {action.error && <RequestError error={action.error} />}
          {(job.state === "failed" || job.state === "uploading") && (
            <Alert>
              <AlertTitle>{t("preparationAttention")}</AlertTitle>
              <AlertDescription>
                <p>{t("preparationDescription")}</p>
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: "prepare" })}
                >
                  {action.isPending ? t("preparing") : t("retryPreparation")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {job.state === "mapping" && (
            <ImportMappingForm key={job.id} job={job} />
          )}
          {(job.state === "processing" || job.state === "completed") && (
            <section className="flex flex-col gap-3" aria-label={t("progress")}>
              <p role="status">
                {t("processingProgress", {
                  processed: job.processed,
                  total: job.total,
                  percent: job.total
                    ? Math.round((job.processed / job.total) * 100)
                    : job.state === "completed"
                      ? 100
                      : 0,
                })}
              </p>
              <progress
                aria-label={t("recordsProcessed")}
                value={
                  job.state === "completed" && job.total === 0
                    ? 1
                    : job.processed
                }
                max={Math.max(job.total, 1)}
                className="h-3 w-full accent-primary"
              />
              {processing.error ? (
                <RequestError
                  error={processing.error}
                  retry={() => processing.mutate(job)}
                />
              ) : (
                job.state === "processing" && (
                  <p className="text-sm text-muted-foreground">
                    {t("automaticProcessing")}
                  </p>
                )
              )}
            </section>
          )}
          {job.state === "completed" && (
            <Alert>
              <AlertTitle>{t("complete")}</AlertTitle>
              <AlertDescription>
                {job.rejected
                  ? t("correctionsNeeded", { count: job.rejected })
                  : t("allAccepted")}
              </AlertDescription>
            </Alert>
          )}
          <ImportRows job={job} />
        </>
      )}
    </div>
  );
}
