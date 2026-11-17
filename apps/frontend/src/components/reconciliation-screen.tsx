"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/components/workspace-provider";
import { request } from "@/services/workspace";
import {
  reconciliationSchema,
  reconciliationDetailSchema,
  matchResultSchema,
  brl,
  dateBR,
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

const statuses = {
  pending: "Pendentes",
  suggested: "Sugeridas",
  partial: "Parciais",
  confirmed: "Confirmadas",
  exceptions: "Exceções",
};
const searchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

export function ReconciliationScreen() {
  const { slug } = useTenant();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [slug, "reconciliation"],
    queryFn: () => request("reconciliation", reconciliationSchema),
  });

  if (query.isPending)
    return (
      <div aria-label="Carregando conciliação" className="flex flex-col gap-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (query.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível carregar a conciliação</AlertTitle>
        <AlertDescription>
          <p>Verifique sua conexão e suas permissões.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
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
              .map((a) => [
                a.title_id,
                (a.amount_minor / 100).toFixed(2).replace(".", ","),
              ]),
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
          ? "Rascunho salvo. Um revisor independente poderá confirmar."
          : action === "pending"
            ? "Crédito mantido pendente."
            : "Sugestão rejeitada. Nenhum saldo foi alterado.",
      );
    } catch {
      setError(
        "Não foi possível salvar. Verifique suas permissões e atualize os saldos antes de tentar novamente.",
      );
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
        decision === "confirmed"
          ? "Conciliação confirmada e registrada no histórico desta aplicação."
          : "Proposta rejeitada. Crédito pendente.",
      );
    } catch {
      setError(
        "A revisão não foi concluída. Os saldos podem ter mudado ou você não tem permissão sobre todas as unidades. Atualize e revise novamente.",
      );
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
              Recebíveis · bancada de trabalho
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Conciliação bancária
            </h1>
            <p className="text-sm text-muted-foreground">
              Do movimento bancário ao título. Confira a origem, distribua o
              valor e revise a decisão.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Atualizar saldos
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
              aria-label="Etapas da conciliação"
              className="flex flex-wrap gap-2 lg:hidden"
            >
              {[
                "Selecionar crédito",
                "Selecionar títulos",
                "Revisar alocação",
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
                      1. Movimentos bancários
                    </h2>
                    <Badge variant="outline">{banks.length} lançamentos</Badge>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="bank-search">
                      Buscar crédito
                    </FieldLabel>
                    <Input
                      id="bank-search"
                      value={bankSearch}
                      onChange={(event) => setBankSearch(event.target.value)}
                      placeholder="Histórico, documento, data ou valor"
                    />
                  </Field>
                  <Select value={bankView} onValueChange={setBankView}>
                    <SelectTrigger aria-label="Visão bancária">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="credits">
                          Movimentos para conciliar
                        </SelectItem>
                        <SelectItem value="entries">
                          Lançamentos bancários · inclui débitos
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-h-[36rem] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Crédito / histórico</TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead className="text-right">
                          Valor / situação
                        </TableHead>
                        <TableHead>
                          <span className="sr-only">Detalhes</span>
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
                            {bank.external_ref || "Sem referência"}
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
                                  ? `Débito · ${statuses[status(bank)]}`
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
                              aria-label={`Detalhes de ${bank.description}`}
                            >
                              Ver origem
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!banks.length && (
                  <NoRows text="Nenhum lançamento neste filtro. Tente outra aba ou busca." />
                )}
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
                        ? "2. Títulos a pagar"
                        : "2. Títulos a receber"}
                    </h2>
                    <Badge variant="outline">Protheus + Omie</Badge>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="title-search">
                      Buscar título
                    </FieldLabel>
                    <Input
                      id="title-search"
                      value={titleSearch}
                      onChange={(event) => setTitleSearch(event.target.value)}
                      placeholder="Cliente, CNPJ ou referência"
                    />
                  </Field>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger aria-label="Sistema de origem">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">Todos os sistemas</SelectItem>
                        <SelectItem value="protheus">Protheus</SelectItem>
                        <SelectItem value="omie">Omie</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {active &&
                    active.unallocated_minor > 0 &&
                    !candidates.length && (
                      <Alert>
                        <AlertTitle>Identidade não comprovada</AlertTitle>
                        <AlertDescription>
                          Não encontramos referência, CNPJ ou nome
                          correspondente. Um valor igual, sozinho, não permite
                          confirmar. Mantenha o depósito pendente.
                        </AlertDescription>
                      </Alert>
                    )}
                  {overlap && (
                    <Alert>
                      <AlertTitle>
                        Possível sobreposição entre fontes
                      </AlertTitle>
                      <AlertDescription>
                        Há títulos de Protheus e Omie com identidade e valor
                        coincidentes. São registros distintos: verifique a
                        origem antes de alocar.
                      </AlertDescription>
                    </Alert>
                  )}
                  {!active && (
                    <p className="text-sm text-muted-foreground">
                      Selecione um crédito à esquerda para distribuir o
                      recebimento.
                    </p>
                  )}
                </div>
                <div className="max-h-[36rem] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <span className="sr-only">Selecionar</span>
                        </TableHead>
                        <TableHead>Origem / cliente</TableHead>
                        <TableHead>Documento / vencimento</TableHead>
                        <TableHead className="text-right">
                          Original / saldo
                        </TableHead>
                        <TableHead>Alocar (R$)</TableHead>
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
                          active.currency !== title.currency;
                        return (
                          <TableRow
                            key={title.id}
                            data-state={checked ? "selected" : undefined}
                          >
                            <TableCell>
                              <Checkbox
                                aria-label={`Selecionar ${title.source_system} ${title.document_ref || title.party_name}`}
                                checked={checked}
                                disabled={disabled}
                                onCheckedChange={(value) => {
                                  setAmounts((current) => {
                                    const next = { ...current };
                                    if (value)
                                      next[title.id] = (
                                        Math.min(
                                          title.outstanding_minor,
                                          Math.max(
                                            0,
                                            (active?.unallocated_minor ?? 0) -
                                              total,
                                          ),
                                        ) / 100
                                      )
                                        .toFixed(2)
                                        .replace(".", ",");
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
                                  {title.party_name ||
                                    "Cliente não identificado"}
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  CNPJ: {title.party_tax_id || "não informado"}
                                </span>
                                {overlaps(title, data.titles) && (
                                  <Badge variant="outline">
                                    Possível sobreposição
                                  </Badge>
                                )}
                                {evidence && (
                                  <div className="flex flex-col gap-1 text-xs">
                                    <Badge variant="outline">
                                      Sugestão · não confirmada
                                    </Badge>
                                    {evidence.evidence.map((reason) => (
                                      <span key={reason}>{reason}</span>
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
                                      Rejeitar sugestão
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span>
                                  {title.document_ref || "Sem documento"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {title.external_id || "Sem referência"}
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
                                    Alocar{" "}
                                    {title.document_ref || title.party_name}
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
                {!titles.length && (
                  <NoRows text="Nenhum título encontrado. Ajuste a busca ou o sistema de origem." />
                )}
                <div className="p-4 lg:hidden">
                  <Button disabled={!active} onClick={() => setStep(3)}>
                    Revisar alocação
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
                      3. Resumo da alocação
                    </h2>
                    <p className="max-w-lg text-sm text-muted-foreground">
                      {active
                        ? `${active.description} · ${brl(active.amount_minor, active.currency)}`
                        : "Nenhum crédito selecionado"}
                      {dirty && " · Alterações não salvas"}
                    </p>
                  </div>
                  <dl className="flex flex-wrap gap-6 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Total alocado</dt>
                      <dd className="text-xl font-semibold tabular-nums">
                        {brl(total, active?.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Crédito não alocado
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
                        · {row.title.document_ref} · alocar{" "}
                        {brl(row.amount || 0, row.title.currency)} · saldo do
                        título após alocação:{" "}
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
                    <AlertTitle>Revise os valores</AlertTitle>
                    <AlertDescription>
                      Use valores positivos com até duas casas decimais, sem
                      exceder o saldo do crédito ou de cada título.
                    </AlertDescription>
                  </Alert>
                )}
                {draft?.origin === "ai" && (
                  <p>Proposta por agente · aguardando aprovação humana</p>
                )}
                {draft && (
                  <p className="text-sm text-muted-foreground">
                    {draft.actor_id === data.actorId
                      ? "Você propôs este rascunho. A confirmação exige outro revisor autorizado."
                      : "Rascunho aguardando revisão independente."}
                  </p>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>Operação não concluída</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {notice && (
                  <p role="status" className="text-sm">
                    {notice}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!active?.can_propose || !valid || !dirty || busy}
                    onClick={() => void save("draft")}
                  >
                    Salvar rascunho
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button
                          disabled={!canConfirm || busy}
                          onClick={() => setConfirm(true)}
                        >
                          Confirmar conciliação
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Salve as alocações; outro revisor autorizado deve
                      verificar a identidade e confirmar.
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    disabled={!active?.can_propose || busy}
                    onClick={() => void save("pending")}
                  >
                    Deixar pendente
                  </Button>
                  {draft &&
                    draft.actor_id !== data.actorId &&
                    active?.can_review && (
                      <Button
                        variant="outline"
                        disabled={busy || dirty}
                        onClick={() => void review("rejected")}
                      >
                        Rejeitar proposta
                      </Button>
                    )}
                  <p className="text-xs text-muted-foreground">
                    Registro local · nenhuma escrita no Itaú, Protheus ou Omie.
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
                  <AlertDialogTitle>
                    Descartar alterações não salvas?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Trocar o crédito descartará as alocações em edição. Volte
                    para salvar o rascunho antes de continuar.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Continuar editando</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (switchTo) choose(switchTo);
                      setSwitchTo(null);
                    }}
                  >
                    Descartar e trocar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Confirmar estas alocações?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    A decisão será auditada nesta aplicação. Não haverá escrita
                    nos sistemas de origem.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <p className="text-sm">
                  {active?.description} · {brl(total, active?.currency)}
                </p>
                <ul className="flex flex-col gap-2 text-sm">
                  {selected.map((row) => (
                    <li key={row.title.id}>
                      {row.title.source_system} · {row.title.document_ref}:{" "}
                      {brl(row.amount, row.title.currency)}. Saldo:{" "}
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
                    <AlertTitle>Possível sobreposição</AlertTitle>
                    <AlertDescription>
                      Confira se os títulos representam obrigações distintas.
                    </AlertDescription>
                  </Alert>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>
                    Voltar à revisão
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy || !canConfirm}
                    onClick={(event) => {
                      event.preventDefault();
                      void review("confirmed");
                    }}
                  >
                    {busy ? "Registrando…" : "Confirmar e registrar"}
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
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Nenhum resultado</EmptyTitle>
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
          <SheetTitle>Origem e histórico da decisão</SheetTitle>
          <SheetDescription>
            Consultar os detalhes preserva o crédito e as alocações em edição.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          {query.isPending && <Skeleton className="h-64 w-full" />}
          {query.error && (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível abrir os detalhes</AlertTitle>
              <AlertDescription>
                <Button onClick={() => void query.refetch()}>
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {query.data && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="font-semibold">Arquivo e linha originais</h3>
                <p>
                  {query.data.source.filename || query.data.source.object_ref}
                </p>
                <p className="text-sm">
                  Linha: {query.data.source.locator} · versão:{" "}
                  {query.data.source.source_version}
                </p>
                {query.data.source.ingestion_id && (
                  <Button asChild variant="outline">
                    <a
                      href={`/api/imports/${query.data.source.ingestion_id}/file`}
                    >
                      Baixar arquivo original
                    </a>
                  </Button>
                )}
                <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {query.data.source.raw_text}
                </pre>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Campos normalizados</h3>
                <dl className="flex flex-col gap-2 text-sm">
                  {Object.entries(query.data.normalized).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="break-all">
                        {value === null ? "Não informado" : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Histórico de decisões</h3>
                {query.data.history.length ? (
                  <ol className="flex flex-col gap-4 text-sm">
                    {query.data.history.map((item) => (
                      <li key={item.id}>
                        <p>{item.rationale}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.created_at).toLocaleString("pt-BR")} ·
                          autor {item.actor_id}
                        </p>
                        {item.review && (
                          <p>
                            {item.review === "confirmed"
                              ? "Confirmada"
                              : "Rejeitada"}{" "}
                            · revisor {item.reviewer_id} ·{" "}
                            {item.reviewed_at &&
                              new Date(item.reviewed_at).toLocaleString(
                                "pt-BR",
                              )}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma decisão registrada.
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
