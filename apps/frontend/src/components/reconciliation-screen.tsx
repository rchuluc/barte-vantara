"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useServerMessage } from "@/i18n/server-messages";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/components/workspace-provider";
import { request } from "@/services/workspace";
import {
  reconciliationSchema,
  reconciliationDetailSchema,
  matchResultSchema,
  parseAllocation,
  overlaps,
  type Reconciliation,
  type BankCredit,
  type MatchInput,
} from "@/lib/reconciliation-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const searchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function ReconciliationScreen() {
  const t = useTranslations("reconciliation");
  const { slug } = useTenant();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [slug, "reconciliation"],
    queryFn: () => request("reconciliation", reconciliationSchema),
  });

  if (query.isPending)
    return (
      <div aria-label={t("loading")} className="flex flex-col gap-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (query.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("loadError")}</AlertTitle>
        <AlertDescription>
          <p>{t("checkConnection")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );

  return (
    <ReconciliationWorkbench
      data={query.data}
      refresh={async () => {
        await client.invalidateQueries({ queryKey: [slug, "reconciliation"] });
      }}
    />
  );
}

export function ReconciliationWorkbench({
  data,
  refresh,
}: {
  data: Reconciliation;
  refresh: () => Promise<void>;
}) {
  const t = useTranslations("reconciliation");
  const format = useFormatter();
  const translateMessage = useServerMessage();
  const brl = (minor: number, currency = "BRL") =>
    format.number(minor / 100, { style: "currency", currency });
  const dateBR = (date: string | null) =>
    date
      ? format.dateTime(new Date(`${date.slice(0, 10)}T00:00:00Z`), {
          dateStyle: "short",
          timeZone: "UTC",
        })
      : t("notProvided");
  const allocationValue = (minor: number) =>
    format.number(minor / 100, {
      useGrouping: false,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const statuses = {
    pending: t("statuses.pending"),
    suggested: t("statuses.suggested"),
    partial: t("statuses.partial"),
    confirmed: t("statuses.confirmed"),
    exceptions: t("statuses.exceptions"),
  };
  const [activeId, setActiveId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [loadedDraft, setLoadedDraft] = useState<string | null>(null);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState("pending");
  const [bankSearch, setBankSearch] = useState("");
  const [titleSearch, setTitleSearch] = useState("");
  const [source, setSource] = useState("all");
  const [bankView, setBankView] = useState("credits");
  const [step, setStep] = useState(1);
  const [detail, setDetail] = useState<{
    kind: "banks" | "titles";
    id: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = data.banks.find((bank) => bank.id === activeId);
  const latest = data.decisions.find(
    (d) =>
      d.bank_entry_id === activeId && d.disposition !== "rejected_suggestion",
  );
  const draft =
    latest?.disposition === "draft" && !latest.review ? latest : undefined;
  const selected = Object.entries(amounts).flatMap(([id, value]) => {
    const title = data.titles.find((t) => t.id === id);
    return title ? [{ title, amount: parseAllocation(value) }] : [];
  });
  const total = selected.reduce(
    (sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0),
    0,
  );
  const valid =
    !!active &&
    selected.length > 0 &&
    selected.length === Object.keys(amounts).length &&
    selected.every(
      (row) =>
        row.title &&
        Number.isSafeInteger(row.amount) &&
        row.amount > 0 &&
        row.amount <= row.title.outstanding_minor,
    ) &&
    total <= active.unallocated_minor;
  const candidates = data.candidates.filter(
    (candidate) =>
      candidate.bankId === activeId &&
      !data.decisions.some(
        (d) =>
          d.bank_entry_id === activeId &&
          d.rejected_title_id === candidate.titleId,
      ),
  );
  const identified =
    selected.length > 0 &&
    selected.every((row) => candidates.some((c) => c.titleId === row.title.id));
  const canConfirm =
    valid &&
    identified &&
    !dirty &&
    !!draft &&
    loadedDraft === draft.id &&
    data.allocations.filter((a) => a.decision_id === draft.id).length ===
      selected.length &&
    selected.every((row) =>
      data.allocations.some(
        (a) =>
          a.decision_id === draft.id &&
          a.title_id === row.title.id &&
          a.amount_minor === row.amount,
      ),
    ) &&
    active?.can_review &&
    draft.actor_id !== data.actorId;
  const overlap =
    candidates.some((c) => {
      const title = data.titles.find((t) => t.id === c.titleId);
      return title && overlaps(title, data.titles);
    }) || selected.some((row) => overlaps(row.title, data.titles));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function choose(id: string) {
    setActiveId(id);
    const decision = data.decisions.find(
      (d) => d.bank_entry_id === id && d.disposition !== "rejected_suggestion",
    );
    setLoadedDraft(decision?.id ?? null);
    setAmounts(
      decision?.disposition === "draft" && !decision.review
        ? Object.fromEntries(
            data.allocations
              .filter((a) => a.decision_id === decision.id)
              .map((a) => [a.title_id, allocationValue(a.amount_minor)]),
          )
        : {},
    );
    setDirty(false);
    setError("");
    setNotice("");
    setStep(2);
  }

  function status(bank: BankCredit) {
    if (bank.unallocated_minor === 0) {
      const hasTitleBalance = data.decisions.some(
        (d) =>
          d.bank_entry_id === bank.id &&
          d.review === "confirmed" &&
          data.allocations.some(
            (a) =>
              a.decision_id === d.id &&
              data.titles.some(
                (t) => t.id === a.title_id && t.outstanding_minor > 0,
              ),
          ),
      );
      return hasTitleBalance ? "partial" : "confirmed";
    }
    if (bank.unallocated_minor < bank.amount_minor) return "partial";
    const last = data.decisions.find(
      (d) =>
        d.bank_entry_id === bank.id && d.disposition !== "rejected_suggestion",
    );
    if (last?.disposition === "pending" || last?.review === "rejected")
      return "pending";
    return data.candidates.some(
      (c) =>
        c.bankId === bank.id &&
        !data.decisions.some(
          (d) =>
            d.bank_entry_id === bank.id && d.rejected_title_id === c.titleId,
        ),
    ) ||
      (last?.disposition === "draft" && !last.review)
      ? "suggested"
      : "pending";
  }

  async function save(action: MatchInput["action"], rejectedTitleId?: string) {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const saved = await request(
        `reconciliation/${active.id}`,
        matchResultSchema,
        "POST",
        {
          id: crypto.randomUUID(),
          action,
          rejectedTitleId,
          allocations:
            action === "draft"
              ? selected.map((row) => ({
                  titleId: row.title.id,
                  amountMinor: row.amount,
                }))
              : [],
        },
      );
      if (action !== "rejected_suggestion") {
        setLoadedDraft(action === "draft" ? saved.id : null);
        setDirty(false);
        if (action === "pending") setAmounts({});
      }
      await refresh();
      setNotice(
        action === "draft"
          ? "draftSaved"
          : action === "pending"
            ? "keptPending"
            : "suggestionRejected",
      );
    } catch {
      setError("saveError");
    } finally {
      setBusy(false);
    }
  }

  async function review(decision: "confirmed" | "rejected") {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `reconciliation/decisions/${draft.id}/review`,
        matchResultSchema,
        "POST",
        { decision },
      );
      setAmounts({});
      setDirty(false);
      setConfirm(false);
      await refresh();
      setNotice(
        decision === "confirmed" ? "confirmedNotice" : "rejectedNotice",
      );
    } catch {
      setError("reviewError");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  const banks = data.banks.filter(
    (bank) =>
      [
        bank.description,
        bank.external_ref,
        bank.booking_date,
        brl(bank.amount_minor),
      ].some((value) => searchText(value).includes(searchText(bankSearch))) &&
      (bankView === "entries" ||
        (tab === "exceptions"
          ? bank.unallocated_minor > 0 &&
            (!data.candidates.some((c) => c.bankId === bank.id) ||
              data.candidates.some(
                (c) =>
                  c.bankId === bank.id &&
                  data.titles.some(
                    (t) => t.id === c.titleId && overlaps(t, data.titles),
                  ),
              ))
          : status(bank) === tab)),
  );
  const titles = data.titles
    .filter(
      (title) =>
        (!active ||
          (title.direction ?? "receivable") ===
            (active.direction === "credit" ? "receivable" : "payable")) &&
        (source === "all" || title.source_system === source) &&
        [
          title.party_name,
          title.party_tax_id,
          title.document_ref,
          title.external_id,
        ].some((value) => searchText(value).includes(searchText(titleSearch))),
    )
    .sort(
      (a, b) =>
        Number(candidates.some((c) => c.titleId === b.id)) -
        Number(candidates.some((c) => c.titleId === a.id)),
    );

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("workspace")}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {t("refreshBalances")}
          </Button>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap">
            {Object.entries(statuses).map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab} className="flex flex-col gap-6">
            <nav
              aria-label={t("steps")}
              className="flex flex-wrap gap-2 lg:hidden"
            >
              {[
                t("selectCredit"),
                t("selectTitles"),
                t("reviewAllocation"),
              ].map((label, index) => (
                <Button
                  key={label}
                  variant={step === index + 1 ? "secondary" : "outline"}
                  disabled={index > 0 && !active}
                  onClick={() => setStep(index + 1)}
                >
                  {index + 1}. {label}
                </Button>
              ))}
            </nav>
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <section
                aria-labelledby="bank-heading"
                className={cn(
                  "min-w-0 rounded-lg border bg-card",
                  step !== 1 && "hidden lg:block",
                )}
              >
                <div className="flex flex-col gap-4 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="bank-heading" className="text-lg font-semibold">
                      {t("bankMovements")}
                    </h2>
                    <Badge variant="outline">
                      {t("entryCount", { count: banks.length })}
                    </Badge>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="bank-search">
                      {t("searchCredit")}
                    </FieldLabel>
                    <Input
                      id="bank-search"
                      value={bankSearch}
                      onChange={(event) => setBankSearch(event.target.value)}
                      placeholder={t("bankSearchPlaceholder")}
                    />
                  </Field>
                  <Select value={bankView} onValueChange={setBankView}>
                    <SelectTrigger aria-label={t("bankView")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="credits">
                          {t("movementsToReconcile")}
                        </SelectItem>
                        <SelectItem value="entries">
                          {t("allEntries")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-h-[36rem] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("creditHistory")}</TableHead>
                        <TableHead>{t("document")}</TableHead>
                        <TableHead className="text-right">
                          {t("amountStatus")}
                        </TableHead>
                        <TableHead>
                          <span className="sr-only">{t("details")}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {banks.map((bank) => (
                        <TableRow
                          key={bank.id}
                          data-state={
                            bank.id === activeId ? "selected" : undefined
                          }
                        >
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <span className="text-xs text-muted-foreground">
                                {dateBR(bank.booking_date)}
                              </span>
                              <Button
                                variant="ghost"
                                className="h-auto max-w-60 justify-start whitespace-normal px-0 text-left"
                                disabled={busy}
                                aria-pressed={bank.id === activeId}
                                onClick={() => {
                                  if (bank.id === activeId) return;
                                  if (dirty) setSwitchTo(bank.id);
                                  else choose(bank.id);
                                }}
                              >
                                {bank.description}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            {bank.external_ref || t("noReference")}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-2">
                              <span className="font-medium tabular-nums">
                                {brl(bank.amount_minor, bank.currency)}
                              </span>
                              <Badge
                                variant={
                                  status(bank) === "confirmed"
                                    ? "default"
                                    : "outline"
                                }
                              >
                                {bank.direction === "debit"
                                  ? t("debitStatus", {
                                      status: statuses[status(bank)],
                                    })
                                  : statuses[status(bank)]}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDetail({ kind: "banks", id: bank.id })
                              }
                              aria-label={t("detailsFor", {
                                name: bank.description,
                              })}
                            >
                              {t("viewSource")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!banks.length && <NoRows text={t("noEntries")} />}
              </section>
              <section
                aria-labelledby="titles-heading"
                className={cn(
                  "min-w-0 rounded-lg border bg-card",
                  step !== 2 && "hidden lg:block",
                )}
              >
                <div className="flex flex-col gap-4 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="titles-heading" className="text-lg font-semibold">
                      {active?.direction === "debit"
                        ? t("payableTitles")
                        : t("receivableTitles")}
                    </h2>
                    <Badge variant="outline">Protheus + Omie</Badge>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="title-search">
                      {t("searchTitle")}
                    </FieldLabel>
                    <Input
                      id="title-search"
                      value={titleSearch}
                      onChange={(event) => setTitleSearch(event.target.value)}
                      placeholder={t("titleSearchPlaceholder")}
                    />
                  </Field>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger aria-label={t("sourceSystem")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">{t("allSystems")}</SelectItem>
                        <SelectItem value="protheus">Protheus</SelectItem>
                        <SelectItem value="omie">Omie</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {active &&
                    active.unallocated_minor > 0 &&
                    !candidates.length && (
                      <Alert>
                        <AlertTitle>{t("identityUnverified")}</AlertTitle>
                        <AlertDescription>
                          {t("identityDescription")}
                        </AlertDescription>
                      </Alert>
                    )}
                  {overlap && (
                    <Alert>
                      <AlertTitle>{t("sourceOverlap")}</AlertTitle>
                      <AlertDescription>
                        {t("sourceOverlapDescription")}
                      </AlertDescription>
                    </Alert>
                  )}
                  {!active && (
                    <p className="text-sm text-muted-foreground">
                      {t("selectCreditHint")}
                    </p>
                  )}
                </div>
                <div className="max-h-[36rem] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <span className="sr-only">{t("select")}</span>
                        </TableHead>
                        <TableHead>{t("sourceParty")}</TableHead>
                        <TableHead>{t("documentDue")}</TableHead>
                        <TableHead className="text-right">
                          {t("originalBalance")}
                        </TableHead>
                        <TableHead>
                          {t("allocateCurrency", {
                            currency: active?.currency ?? "BRL",
                          })}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {titles.map((title) => {
                        const evidence = candidates.find(
                          (c) => c.titleId === title.id,
                        );
                        const checked = title.id in amounts;
                        const disabled =
                          !active?.can_propose ||
                          busy ||
                          title.outstanding_minor === 0 ||
                          title.status !== "open" ||
                          title.observation_state !== "expected" ||
                          active.currency !== title.currency ||
                          (active.statement_unit_ids != null &&
                            !active.statement_unit_ids.includes(title.unit_id));
                        return (
                          <TableRow
                            key={title.id}
                            data-state={checked ? "selected" : undefined}
                          >
                            <TableCell>
                              <Checkbox
                                aria-label={t("selectTitleLabel", {
                                  source: title.source_system,
                                  name:
                                    title.document_ref ||
                                    title.party_name ||
                                    t("unknownParty"),
                                })}
                                checked={checked}
                                disabled={disabled}
                                onCheckedChange={(value) => {
                                  setAmounts((current) => {
                                    const next = { ...current };
                                    if (value)
                                      next[title.id] = allocationValue(
                                        Math.min(
                                          title.outstanding_minor,
                                          Math.max(
                                            0,
                                            (active?.unallocated_minor ?? 0) -
                                              total,
                                          ),
                                        ),
                                      );
                                    else delete next[title.id];
                                    return next;
                                  });
                                  setDirty(true);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex max-w-64 flex-col items-start gap-2">
                                <Badge variant="secondary">
                                  {title.source_system === "protheus"
                                    ? "Protheus"
                                    : title.source_system === "omie"
                                      ? "Omie"
                                      : title.source_system}
                                </Badge>
                                <Button
                                  className="h-auto whitespace-normal px-0 text-left"
                                  variant="ghost"
                                  onClick={() =>
                                    setDetail({ kind: "titles", id: title.id })
                                  }
                                >
                                  {title.party_name || t("unknownParty")}
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {t("taxId", {
                                    value:
                                      title.party_tax_id || t("notProvided"),
                                  })}
                                </span>
                                {overlaps(title, data.titles) && (
                                  <Badge variant="outline">
                                    {t("overlap")}
                                  </Badge>
                                )}
                                {evidence && (
                                  <div className="flex flex-col gap-1 text-xs">
                                    <Badge variant="outline">
                                      {t("unconfirmedSuggestion")}
                                    </Badge>
                                    {evidence.evidence.map((reason) => (
                                      <span key={reason}>
                                        {translateMessage(reason)}
                                      </span>
                                    ))}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={!active?.can_propose || busy}
                                      onClick={() =>
                                        void save(
                                          "rejected_suggestion",
                                          title.id,
                                        )
                                      }
                                    >
                                      {t("rejectSuggestion")}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span>
                                  {title.document_ref || t("noDocument")}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {title.external_id || t("noReference")}
                                </span>
                                <span>{dateBR(title.due_on)}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div className="flex flex-col gap-1">
                                <span>
                                  {brl(
                                    title.original_amount_minor,
                                    title.currency,
                                  )}
                                </span>
                                <span className="font-medium">
                                  {brl(title.outstanding_minor, title.currency)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {checked ? (
                                <Field>
                                  <FieldLabel
                                    className="sr-only"
                                    htmlFor={`amount-${title.id}`}
                                  >
                                    {t("allocateTitle", {
                                      name:
                                        title.document_ref ||
                                        title.party_name ||
                                        t("unknownParty"),
                                    })}
                                  </FieldLabel>
                                  <Input
                                    id={`amount-${title.id}`}
                                    className="w-28 tabular-nums"
                                    inputMode="decimal"
                                    value={amounts[title.id]}
                                    disabled={disabled}
                                    aria-invalid={
                                      !Number.isFinite(
                                        parseAllocation(amounts[title.id]),
                                      ) ||
                                      parseAllocation(amounts[title.id]) <= 0 ||
                                      parseAllocation(amounts[title.id]) >
                                        title.outstanding_minor
                                    }
                                    onChange={(event) => {
                                      setAmounts((current) => ({
                                        ...current,
                                        [title.id]: event.target.value,
                                      }));
                                      setDirty(true);
                                    }}
                                  />
                                </Field>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {!titles.length && <NoRows text={t("noTitles")} />}
                <div className="p-4 lg:hidden">
                  <Button disabled={!active} onClick={() => setStep(3)}>
                    {t("reviewAllocation")}
                  </Button>
                </div>
              </section>
            </div>
            <section
              aria-labelledby="allocation-heading"
              className={cn(
                "bottom-0 rounded-lg border bg-background p-5 shadow-sm lg:sticky",
                step !== 3 && "hidden lg:block",
              )}
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 id="allocation-heading" className="font-semibold">
                      {t("allocationSummary")}
                    </h2>
                    <p className="max-w-lg text-sm text-muted-foreground">
                      {active
                        ? `${active.description} · ${brl(active.amount_minor, active.currency)}`
                        : t("noCreditSelected")}
                      {dirty && t("unsavedSuffix")}
                    </p>
                  </div>
                  <dl className="flex flex-wrap gap-6 text-sm">
                    <div>
                      <dt className="text-muted-foreground">
                        {t("totalAllocated")}
                      </dt>
                      <dd className="text-xl font-semibold tabular-nums">
                        {brl(total, active?.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {t("unallocatedCredit")}
                      </dt>
                      <dd className="text-xl font-semibold tabular-nums">
                        {brl(
                          (active?.unallocated_minor ?? 0) - total,
                          active?.currency,
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {selected.length > 0 && (
                  <ul className="flex max-h-32 flex-col gap-1 overflow-auto text-sm">
                    {selected.map((row) => (
                      <li key={row.title.id}>
                        {row.title.source_system === "protheus"
                          ? "Protheus"
                          : row.title.source_system === "omie"
                            ? "Omie"
                            : row.title.source_system}{" "}
                        · {row.title.document_ref} ·{" "}
                        {t("allocationBalance", {
                          amount: brl(row.amount || 0, row.title.currency),
                        })}{" "}
                        <strong>
                          {brl(
                            row.title.outstanding_minor - (row.amount || 0),
                            row.title.currency,
                          )}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
                {selected.length > 0 && !valid && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("reviewAmounts")}</AlertTitle>
                    <AlertDescription>{t("amountsHint")}</AlertDescription>
                  </Alert>
                )}
                {draft?.origin === "ai" && <p>{t("agentProposal")}</p>}
                {draft && (
                  <p className="text-sm text-muted-foreground">
                    {draft.actor_id === data.actorId
                      ? t("ownDraft")
                      : t("awaitingReview")}
                  </p>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("operationIncomplete")}</AlertTitle>
                    <AlertDescription>{t(error)}</AlertDescription>
                  </Alert>
                )}
                {notice && (
                  <p role="status" className="text-sm">
                    {t(notice)}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!active?.can_propose || !valid || !dirty || busy}
                    onClick={() => void save("draft")}
                  >
                    {t("saveDraft")}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button
                          disabled={!canConfirm || busy}
                          onClick={() => setConfirm(true)}
                        >
                          {t("confirmReconciliation")}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("reviewerHint")}</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    disabled={!active?.can_propose || busy}
                    onClick={() => void save("pending")}
                  >
                    {t("leavePending")}
                  </Button>
                  {draft &&
                    draft.actor_id !== data.actorId &&
                    active?.can_review && (
                      <Button
                        variant="outline"
                        disabled={busy || dirty}
                        onClick={() => void review("rejected")}
                      >
                        {t("rejectProposal")}
                      </Button>
                    )}
                  <p className="text-xs text-muted-foreground">
                    {t("localRecord")}
                  </p>
                </div>
              </div>
            </section>
            <AlertDialog
              open={!!switchTo}
              onOpenChange={(open) => {
                if (!open) setSwitchTo(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("discardQuestion")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("discardDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("keepEditing")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (switchTo) choose(switchTo);
                      setSwitchTo(null);
                    }}
                  >
                    {t("discardAndSwitch")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("confirmAllocations")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("confirmDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <p className="text-sm">
                  {active?.description} · {brl(total, active?.currency)}
                </p>
                <ul className="flex flex-col gap-2 text-sm">
                  {selected.map((row) => (
                    <li key={row.title.id}>
                      {row.title.source_system} · {row.title.document_ref}:{" "}
                      {brl(row.amount, row.title.currency)}. {t("balanceLabel")}{" "}
                      {brl(
                        row.title.outstanding_minor - row.amount,
                        row.title.currency,
                      )}
                      .
                    </li>
                  ))}
                </ul>
                {overlap && (
                  <Alert>
                    <AlertTitle>{t("overlap")}</AlertTitle>
                    <AlertDescription>{t("overlapHint")}</AlertDescription>
                  </Alert>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>
                    {t("backToReview")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy || !canConfirm}
                    onClick={(event) => {
                      event.preventDefault();
                      void review("confirmed");
                    }}
                  >
                    {busy ? t("recording") : t("confirmAndRecord")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <ReconciliationDetails
              detail={detail}
              close={() => setDetail(null)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

function NoRows({ text }: { text: string }) {
  const t = useTranslations("reconciliation");
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("noResults")}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ReconciliationDetails({
  detail,
  close,
}: {
  detail: { kind: "banks" | "titles"; id: string } | null;
  close: () => void;
}) {
  const t = useTranslations("reconciliation");
  const translateMessage = useServerMessage();
  const format = useFormatter();
  const { slug } = useTenant();
  const query = useQuery({
    queryKey: [slug, "reconciliation", "detail", detail?.kind, detail?.id],
    enabled: !!detail,
    queryFn: () =>
      request(
        `reconciliation/${detail!.kind}/${detail!.id}/details`,
        reconciliationDetailSchema,
      ),
  });

  return (
    <Sheet
      open={!!detail}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("sourceHistory")}</SheetTitle>
          <SheetDescription>{t("detailsDescription")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          {query.isPending && <Skeleton className="h-64 w-full" />}
          {query.error && (
            <Alert variant="destructive">
              <AlertTitle>{t("detailsError")}</AlertTitle>
              <AlertDescription>
                <Button onClick={() => void query.refetch()}>
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {query.data && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="font-semibold">{t("originalFileRow")}</h3>
                <p>
                  {query.data.source.filename || query.data.source.object_ref}
                </p>
                <p className="text-sm">
                  {t("sourceVersion", {
                    row: query.data.source.locator,
                    version: query.data.source.source_version,
                  })}
                </p>
                {query.data.source.ingestion_id && (
                  <Button asChild variant="outline">
                    <a
                      href={`/api/imports/${query.data.source.ingestion_id}/file`}
                    >
                      {t("downloadOriginal")}
                    </a>
                  </Button>
                )}
                <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {query.data.source.raw_text}
                </pre>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">{t("normalizedFields")}</h3>
                <dl className="flex flex-col gap-2 text-sm">
                  {Object.entries(query.data.normalized).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">
                        {t.has(`fields.${key}`) ? t(`fields.${key}`) : key}
                      </dt>
                      <dd className="break-all">
                        {value === null
                          ? t("notProvided")
                          : typeof value === "number"
                            ? format.number(value)
                            : typeof value === "string" &&
                                [
                                  "direction",
                                  "status",
                                  "observation_state",
                                ].includes(key) &&
                                t.has(`values.${value}`)
                              ? t(`values.${value}`)
                              : typeof value === "string" &&
                                  [
                                    "booking_date",
                                    "value_date",
                                    "issued_on",
                                    "due_on",
                                  ].includes(key)
                                ? format.dateTime(
                                    new Date(`${value.slice(0, 10)}T00:00:00Z`),
                                    { dateStyle: "short", timeZone: "UTC" },
                                  )
                                : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">{t("decisionHistory")}</h3>
                {query.data.history.length ? (
                  <ol className="flex flex-col gap-4 text-sm">
                    {query.data.history.map((item) => (
                      <li key={item.id}>
                        <p>{translateMessage(item.rationale)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("author", {
                            date: format.dateTime(new Date(item.created_at), {
                              dateStyle: "short",
                              timeStyle: "short",
                              timeZone: "UTC",
                            }),
                            id: item.actor_id,
                          })}
                        </p>
                        {item.review && (
                          <p>
                            {item.review === "confirmed"
                              ? t("confirmed")
                              : t("rejected")}{" "}
                            ·{" "}
                            {t("reviewer", {
                              id: item.reviewer_id ?? t("notProvided"),
                            })}{" "}
                            ·{" "}
                            {item.reviewed_at &&
                              format.dateTime(new Date(item.reviewed_at), {
                                dateStyle: "short",
                                timeStyle: "short",
                                timeZone: "UTC",
                              })}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("noDecisions")}
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
