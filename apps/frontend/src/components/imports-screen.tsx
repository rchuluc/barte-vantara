"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { useImports } from "@/hooks/use-imports";
import { useMe } from "@/hooks/use-workspace";
import { datasetSchema, importPermission } from "@/lib/import-contracts";
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
  const t = useTranslations("imports");
  const c = useTranslations("ui");
  const format = useFormatter();
  const [offset, setOffset] = useState(0);
  const query = useImports(offset);
  const me = useMe();
  const router = useRouter();
  const kinds = datasetSchema.options.filter((kind) =>
    me.data?.permissions.includes(importPermission(kind)),
  );

  return (
    <div className="import-workspace flex flex-col gap-8 pb-20">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("workspace")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            {t("description")}
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
          ["01", t("uploadStep"), t("uploadStepDescription")],
          ["02", t("mappingStep"), t("mappingStepDescription")],
          ["03", t("exceptionsStep"), t("exceptionsStepDescription")],
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
            <CardTitle>{t("history")}</CardTitle>
            <CardDescription>{t("historyDescription")}</CardDescription>
          </div>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            <RefreshCw data-icon="inline-start" />
            {t("refresh")}
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
                  {offset ? t("noMore") : t("firstImport")}
                </EmptyTitle>
                <EmptyDescription>
                  {kinds.length ? t("emptyCanImport") : t("emptyNoPermission")}
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
                      {t(`datasets.${job.dataset_kind}`)} ·{" "}
                      {job.platform ?? t("detecting")} ·{" "}
                      {format.dateTime(new Date(job.created_at), {
                        dateStyle: "short",
                        timeZone: "UTC",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {t("processed", {
                        processed: job.processed,
                        total: job.total,
                      })}
                      {job.rejected > 0
                        ? t("rejectedSuffix", { count: job.rejected })
                        : ""}
                    </p>
                    <Badge
                      variant={
                        job.state === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {t(`states.${job.state}`)}
                    </Badge>
                    <Button asChild variant="outline">
                      <Link
                        href={`/imports/${job.id}`}
                        aria-label={t("reviewFile", { name: job.filename })}
                      >
                        {t("review")}
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
          {t("previousImports")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {c("page", { page: offset / 20 + 1 })}
        </span>
        <Button
          variant="outline"
          disabled={!query.data || query.data.length < 20 || query.isFetching}
          onClick={() => setOffset(offset + 20)}
        >
          {t("nextImports")}
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
