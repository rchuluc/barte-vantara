"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  useImport,
  useImportAction,
  useProcessImport,
  useLeaveImport,
} from "@/hooks/use-imports";
import { datasetLabels } from "@/lib/import-contracts";
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
  const query = useImport(id);
  const action = useImportAction(id);
  const job = query.data;
  const processing = useProcessImport(job);
  const departure = useLeaveImport(id);
  const [leaving, setLeaving] = useState(false);

  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <Alert className="import-workspace">
        <AlertTitle>Import unavailable</AlertTitle>
        <AlertDescription>
          <p>
            This import could not be found. If you refreshed before confirming,
            your preview was discarded. Return to imports and select your file
            again.
          </p>
          <Button onClick={departure.leave}>Return to imports</Button>
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
            All imports
          </Button>
        </DialogTrigger>
        <DialogContent className="import-workspace">
          <DialogHeader>
            <DialogTitle>
              {departure.unconfirmed
                ? "Discard this preview?"
                : "Leave this import?"}
            </DialogTitle>
            <DialogDescription>
              {departure.unconfirmed
                ? "Leaving discards this preview. Your file and mapping won't be saved."
                : "Confirmed imports remain saved. If processing is unfinished, it resumes when you return to this import."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>
              Stay here
            </Button>
            <Button
              variant={departure.unconfirmed ? "destructive" : "default"}
              onClick={departure.leave}
            >
              {departure.unconfirmed ? "Discard preview" : "Back to imports"}
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
                {datasetLabels[job.dataset_kind]} ·{" "}
                {job.platform ?? "Detecting format"}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight break-all">
                {job.filename}
              </h1>
            </div>
            <Badge
              variant={job.state === "failed" ? "destructive" : "secondary"}
            >
              {job.state}
            </Badge>
          </header>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Source records", job.total],
              ["Accepted", job.processed - job.rejected],
              ["Needs correction", job.rejected],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">
                    {Number(value).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          {action.error && <RequestError error={action.error} />}
          {(job.state === "failed" || job.state === "uploading") && (
            <Alert>
              <AlertTitle>File preparation needs attention</AlertTitle>
              <AlertDescription>
                <p>
                  Retry reading the saved original. If the upload never
                  finished, return to imports and upload the file again.
                </p>
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: "prepare" })}
                >
                  {action.isPending ? "Preparing…" : "Retry preparation"}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {job.state === "mapping" && (
            <ImportMappingForm key={job.id} job={job} />
          )}
          {(job.state === "processing" || job.state === "completed") && (
            <section
              className="flex flex-col gap-3"
              aria-label="Processing progress"
            >
              <p role="status">
                {job.processed.toLocaleString()} of {job.total.toLocaleString()}{" "}
                records processed ·{" "}
                {job.total
                  ? Math.round((job.processed / job.total) * 100)
                  : job.state === "completed"
                    ? 100
                    : 0}
                %
              </p>
              <progress
                aria-label="Records processed"
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
                    Importing automatically. Keep this page open; if you leave,
                    processing resumes when you return.
                  </p>
                )
              )}
            </section>
          )}
          {job.state === "completed" && (
            <Alert>
              <AlertTitle>Processing complete</AlertTitle>
              <AlertDescription>
                {job.rejected
                  ? `${job.rejected} records need correction. Save your changes below; corrected records are imported automatically.`
                  : "All records were accepted. Your imported data is ready."}
              </AlertDescription>
            </Alert>
          )}
          <ImportRows job={job} />
        </>
      )}
    </div>
  );
}
