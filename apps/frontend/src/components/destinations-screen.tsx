"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpDown, Plus } from "lucide-react";
import { useMe } from "@/hooks/use-workspace";
import {
  useUnits,
  useBankAccounts,
  useSaveDestination,
} from "@/hooks/use-destinations";
import {
  accountLabel,
  type BusinessUnit,
  type BankAccount,
  type DestinationKind,
} from "@/lib/destination-contracts";
import {
  BusinessUnitDialog,
  BankAccountDialog,
} from "@/components/destination-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Loading, RequestError } from "@/components/request-feedback";

export function DestinationsScreen({ kind }: { kind: DestinationKind }) {
  const t = useTranslations("ui");
  const me = useMe();

  if (me.error) return <RequestError error={me.error} />;
  if (!me.data) return <Loading />;
  if (!me.data.permissions.includes("configure"))
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("adminRequired")}</AlertTitle>
        <AlertDescription>{t("cannotManageDestinations")}</AlertDescription>
      </Alert>
    );

  return kind === "business-units" ? <UnitsTable /> : <AccountsTable />;
}

function UnitsTable() {
  const query = useUnits();

  if (query.error)
    return (
      <RequestError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (!query.data) return <Loading />;
  return <DestinationTable kind="business-units" records={query.data} />;
}

function AccountsTable() {
  const query = useBankAccounts();
  const units = useUnits();

  const error = query.error ?? units.error;
  if (error)
    return (
      <RequestError
        error={error}
        retry={() => {
          void query.refetch();
          void units.refetch();
        }}
      />
    );
  if (!query.data || !units.data) return <Loading />;
  return (
    <DestinationTable
      kind="bank-accounts"
      records={query.data}
      units={units.data}
    />
  );
}

function DestinationTable({
  kind,
  records,
  units = [],
}: {
  kind: DestinationKind;
  records: (BusinessUnit | BankAccount)[];
  units?: BusinessUnit[];
}) {
  const t = useTranslations("ui");
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [descending, setDescending] = useState(false);
  const [editor, setEditor] = useState<
    BusinessUnit | BankAccount | "new" | null
  >(null);
  const [notice, setNotice] = useState<{ key: string; name?: string }>();
  const save = useSaveDestination(kind);
  const unit = kind === "business-units";
  const label = (record: BusinessUnit | BankAccount) =>
    "name" in record ? record.name : accountLabel(record);
  const unitName = (record: BankAccount) =>
    record.unit_ids
      .map(
        (id) =>
          units.find((unit) => unit.id === id)?.name ?? t("unavailableUnit"),
      )
      .join(", ");
  const filtered = records
    .filter((record) =>
      `${label(record)} ${"unit_ids" in record ? unitName(record) : ""} ${record.active ? t("active") : t("disabled")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        label(a).localeCompare(label(b), locale) * (descending ? -1 : 1),
    );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  const close = () => setEditor(null);
  const saved = () => {
    close();
    setNotice({ key: "changesSaved" });
  };

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {t("administration")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {unit ? t("businessUnits") : t("bankAccounts")}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {t("destinationsDescription")}
          </p>
        </div>
        <Button onClick={() => setEditor("new")}>
          <Plus data-icon="inline-start" />
          {t(unit ? "createUnit" : "createAccount")}
        </Button>
      </header>
      {notice && (
        <p role="status">{t(notice.key, { name: notice.name ?? "" })}</p>
      )}
      {save.error && <RequestError error={save.error} />}
      <Input
        aria-label={t("searchRecords")}
        placeholder={t("searchRecordsPlaceholder")}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(0);
        }}
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button
                  variant="ghost"
                  onClick={() => setDescending(!descending)}
                >
                  {unit ? t("name") : t("account")}
                  <ArrowUpDown data-icon="inline-end" />
                </Button>
              </TableHead>
              {!unit && <TableHead>{t("businessUnits")}</TableHead>}
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered
              .slice(currentPage * 20, currentPage * 20 + 20)
              .map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{label(record)}</TableCell>
                  {"unit_ids" in record && (
                    <TableCell>{unitName(record)}</TableCell>
                  )}
                  <TableCell>
                    <Badge variant={record.active ? "secondary" : "outline"}>
                      {record.active ? t("active") : t("disabled")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={
                          "configurable" in record && !record.configurable
                        }
                        onClick={() => setEditor(record)}
                      >
                        {t("update")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={
                          save.isPending ||
                          !record.active ||
                          ("configurable" in record && !record.configurable)
                        }
                        onClick={() =>
                          save.mutate(
                            {
                              id: record.id,
                              body:
                                "name" in record
                                  ? { name: record.name, active: false }
                                  : {
                                      bankCode: record.bank_code,
                                      accountRef: record.account_ref,
                                      active: false,
                                    },
                            },
                            {
                              onSuccess: () =>
                                setNotice({
                                  key: "recordDisabled",
                                  name: label(record),
                                }),
                            },
                          )
                        }
                      >
                        {t("disable")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={unit ? 3 : 4} className="h-24 text-center">
                  {t("noRecords")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <nav
        aria-label={t("recordPages")}
        className="flex items-center justify-between gap-3"
      >
        <Button
          variant="outline"
          disabled={!currentPage}
          onClick={() => setPage(currentPage - 1)}
        >
          {t("previous")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("pageRecords", { page: currentPage + 1, count: filtered.length })}
        </span>
        <Button
          variant="outline"
          disabled={(currentPage + 1) * 20 >= filtered.length}
          onClick={() => setPage(currentPage + 1)}
        >
          {t("next")}
        </Button>
      </nav>
      {editor &&
        (unit ? (
          <BusinessUnitDialog
            unit={editor !== "new" && "name" in editor ? editor : undefined}
            close={close}
            saved={saved}
          />
        ) : (
          <BankAccountDialog
            account={
              editor !== "new" && "unit_ids" in editor ? editor : undefined
            }
            close={close}
            saved={saved}
          />
        ))}
    </section>
  );
}
