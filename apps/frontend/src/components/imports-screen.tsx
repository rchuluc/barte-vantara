"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { useImports } from "@/hooks/use-imports";
import { useMe } from "@/hooks/use-workspace";
import {
  datasetSchema,
  datasetLabels,
  importPermission,
} from "@/lib/import-contracts";
import { ImportUpload } from "@/components/import-upload";
import { ImportAssistant } from "@/components/import-assistant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Loading, RequestError } from "@/components/request-feedback";

export function ImportsScreen() {
  const [offset, setOffset] = useState(0);
  const query = useImports(offset);
  const me = useMe();
  const router = useRouter();
  const kinds = datasetSchema.options.filter((kind) =>
    me.data?.permissions.includes(importPermission(kind)),
  );

  return (
    <div className="import-workspace mx-auto flex max-w-6xl flex-col gap-8 pb-20">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Data workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Data imports
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Bring your financial data together. Upload a file, match its
            columns, and review every record.
          </p>
        </div>
        {kinds.length > 0 && (
          <ImportUpload
            kinds={kinds}
            onUploaded={(id) => router.push(`/imports/${id}`)}
          />
        )}
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            "01",
            "Upload your file",
            "CSV and XLSX, including Omie, Protheus, and Itaú formats.",
          ],
          [
            "02",
            "Review the mapping",
            "Check columns, business units, and number formats before importing.",
          ],
          [
            "03",
            "Resolve exceptions",
            "Track accepted records and correct individual rejected rows.",
          ],
        ].map(([step, title, description]) => (
          <div
            key={step}
            className="flex flex-col gap-2 border-t border-border pt-4"
          >
            <p className="text-xs tabular-nums text-muted-foreground">{step}</p>
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Import history</CardTitle>
            <CardDescription>
              Files visible to your account and business-unit scope.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <RequestError
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : !query.data ? (
            <Loading />
          ) : !query.data.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSpreadsheet aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  {offset ? "No more imports" : "Your first import starts here"}
                </EmptyTitle>
                <EmptyDescription>
                  {kinds.length
                    ? "Choose New import to upload a CSV or spreadsheet. You can review the mapping before processing."
                    : "No imports are visible yet. Ask your administrator for import permissions if you need to upload a file."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {query.data.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-5"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/imports/${job.id}`}
                      className="font-medium break-all underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {job.filename}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {datasetLabels[job.dataset_kind]} ·{" "}
                      {job.platform ?? "Detecting"} ·{" "}
                      {new Date(job.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {job.processed.toLocaleString()} /{" "}
                      {job.total.toLocaleString()} processed
                      {job.rejected > 0 ? ` · ${job.rejected} rejected` : ""}
                    </p>
                    <Badge
                      variant={
                        job.state === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {job.state}
                    </Badge>
                    <Button asChild variant="outline">
                      <Link
                        href={`/imports/${job.id}`}
                        aria-label={`Review ${job.filename}`}
                      >
                        Review
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={offset === 0 || query.isFetching}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous imports
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {offset / 20 + 1}
        </span>
        <Button
          variant="outline"
          disabled={!query.data || query.data.length < 20 || query.isFetching}
          onClick={() => setOffset(offset + 20)}
        >
          Next imports
        </Button>
      </div>
      {kinds.includes("payable") && (
        <ImportAssistant
          onImported={() => {
            void query.refetch();
          }}
        />
      )}
    </div>
  );
}
