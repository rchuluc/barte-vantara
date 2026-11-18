import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/components/workspace-provider";
import ReconciliationPage from "@/app/[tenant]/(workspace)/reconciliation/page";
import {
  ReconciliationWorkbench,
  ReconciliationScreen,
} from "@/components/reconciliation-screen";
import {
  type Reconciliation,
  type Receivable,
  parseAllocation,
  overlaps,
} from "@/lib/reconciliation-contracts";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fetchMock = vi.fn<typeof fetch>();
const refresh = vi.fn(async () => {});
let data: Reconciliation;

function title(
  n: number,
  name: string,
  amount: number,
  source: "protheus" | "omie" = "protheus",
): Receivable {
  return {
    id: id(n),
    unit_id: id(90),
    source_system: source,
    party_name: name,
    party_tax_id: "98.765.432/0001-11",
    document_ref: `NF ${n}`,
    external_id: `REF${n}`,
    due_on: "2026-07-20",
    currency: "BRL",
    original_amount_minor: amount,
    outstanding_minor: amount,
    status: "open",
    observation_state: "expected",
  };
}

beforeEach(() => {
  refresh.mockClear();
  data = {
    actorId: id(99),
    banks: [
      {
        id: id(1),
        unit_id: id(90),
        direction: "credit",
        booking_date: "2026-07-14",
        description: "TED DOCE PONTO",
        external_ref: null,
        amount_minor: 4763050,
        unallocated_minor: 4763050,
        currency: "BRL",
        can_propose: true,
        can_review: true,
      },
      {
        id: id(2),
        unit_id: id(90),
        direction: "credit",
        booking_date: "2026-07-16",
        description: "BELA VISTA",
        external_ref: "REF12",
        amount_minor: 6250000,
        unallocated_minor: 6250000,
        currency: "BRL",
        can_propose: true,
        can_review: true,
      },
      {
        id: id(3),
        unit_id: id(90),
        direction: "credit",
        booking_date: "2026-07-28",
        description: "DEPOSITO NAO IDENTIFICADO",
        external_ref: null,
        amount_minor: 567000,
        unallocated_minor: 567000,
        currency: "BRL",
        can_propose: true,
        can_review: true,
      },
    ],
    titles: [
      title(10, "Doce Ponto", 4278050),
      title(11, "Doce Ponto", 485000),
      title(12, "Bela Vista", 12500000),
      title(13, "Grão Nobre", 3125000),
      title(14, "Grão Nobre", 3125000, "omie"),
      title(15, "Sem identificação", 567000, "omie"),
    ],
    decisions: [],
    allocations: [],
    candidates: [
      {
        bankId: id(1),
        titleId: id(10),
        evidence: ["Nome no histórico: DOCE PONTO"],
      },
      {
        bankId: id(1),
        titleId: id(11),
        evidence: ["Nome no histórico: DOCE PONTO"],
      },
      {
        bankId: id(2),
        titleId: id(12),
        evidence: ["Referência coincidente: REF12"],
      },
    ],
  };
  fetchMock.mockReset().mockImplementation(async (url) => {
    if (String(url).endsWith("/details"))
      return Response.json({
        normalized: { description: "TED DOCE PONTO" },
        source: {
          locator: "record:5",
          raw_text: "original",
          object_ref: "source.csv",
          source_version: "v1",
          ingestion_id: null,
          filename: "source.csv",
        },
        history: [],
      });
    return Response.json({ id: id(50) });
  });
  vi.stubGlobal("fetch", fetchMock);
});

function mount() {
  return render(
    <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
      <ReconciliationWorkbench data={data} refresh={refresh} />
    </WorkspaceProvider>,
  );
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function choose(name = "TED DOCE PONTO") {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Sugeridas" }), {
    button: 0,
    ctrlKey: false,
  });
  click(name);
}
function select(n: number, source = "protheus") {
  fireEvent.click(
    screen.getByRole("checkbox", { name: `Selecionar ${source} NF ${n}` }),
  );
}

it("allocates the Doce Ponto credit across two titles and preserves edits through details and cancelled switching", async () => {
  mount();
  choose();
  select(10);
  select(11);
  expect(screen.getByLabelText("Alocar NF 10")).toHaveValue("42780,50");
  expect(screen.getByLabelText("Alocar NF 11")).toHaveValue("4850,00");
  expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
  click("Detalhes de TED DOCE PONTO");
  await screen.findByText("source.csv");
  expect(
    screen.getByRole("dialog", { name: "Origem e histórico da decisão" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  click("BELA VISTA");
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "Descartar alterações",
  );
  click("Continuar editando");
  expect(screen.getByLabelText("Alocar NF 11")).toHaveValue("4850,00");
  click("Salvar rascunho");
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([, opts]) => opts?.method === "POST");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
    action: "draft",
    allocations: [
      { titleId: id(10), amountMinor: 4278050 },
      { titleId: id(11), amountMinor: 485000 },
    ],
  });
});

it("allows only titles in the selected statement units", () => {
  data.banks[0].statement_unit_ids = [id(90), id(91)];
  data.titles[1].unit_id = id(91);
  data.titles[2].unit_id = id(92);
  mount();
  choose();
  expect(
    screen.getByRole("checkbox", { name: "Selecionar protheus NF 10" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("checkbox", { name: "Selecionar protheus NF 11" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("checkbox", { name: "Selecionar protheus NF 12" }),
  ).toBeDisabled();
});

it("shows the title balance for a partial allocation and prevents excess and malformed amounts", () => {
  mount();
  choose("BELA VISTA");
  select(12);
  expect(screen.getByLabelText("Alocar NF 12")).toHaveValue("62500,00");
  expect(screen.getByText(/saldo do título após alocação/)).toHaveTextContent(
    "R$ 62.500,00",
  );
  for (const value of ["62500,01", "125000,01", "-1", "1,001", "0", ""]) {
    fireEvent.change(screen.getByLabelText("Alocar NF 12"), {
      target: { value },
    });
    expect(
      screen.getByRole("button", { name: "Salvar rascunho" }),
    ).toBeDisabled();
  }
});

it("keeps duplicate-source titles distinct and warns about overlap", () => {
  data.candidates.push({
    bankId: id(2),
    titleId: id(13),
    evidence: ["Referência coincidente"],
  });
  mount();
  choose("BELA VISTA");
  expect(
    screen.getByRole("checkbox", { name: "Selecionar protheus NF 13" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Selecionar omie NF 14" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Possível sobreposição entre fontes"),
  ).toBeInTheDocument();
});

it("does not treat an equal amount as identity and leaves an unidentified deposit pending", async () => {
  mount();
  click("DEPOSITO NAO IDENTIFICADO");
  select(15, "omie");
  expect(screen.getByText("Identidade não comprovada")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Confirmar conciliação" }),
  ).toBeDisabled();
  click("Deixar pendente");
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
    action: "pending",
    allocations: [],
  });
});

it("requires a saved independent proposal and an explicit AlertDialog confirmation", async () => {
  data.decisions.push({
    id: id(50),
    bank_entry_id: id(1),
    actor_id: id(98),
    created_at: "2026-07-21T12:00:00Z",
    rationale: "Proposta",
    disposition: "draft",
    review: null,
    reviewer_id: null,
    reviewed_at: null,
    rejected_title_id: null,
  });
  data.allocations = [
    { decision_id: id(50), title_id: id(10), amount_minor: 4278050 },
    { decision_id: id(50), title_id: id(11), amount_minor: 485000 },
  ];
  mount();
  choose();
  click("Confirmar conciliação");
  const dialog = screen.getByRole("alertdialog", {
    name: "Confirmar estas alocações?",
  });
  expect(within(dialog).getByText(/NF 10/)).toHaveTextContent("R$ 42.780,50");
  expect(fetchMock).not.toHaveBeenCalled();
  click("Confirmar e registrar");
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/reconciliation/decisions/${id(50)}/review`,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ decision: "confirmed" }),
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("confirmada");
});

it.each(["confirmed", "rejected"])(
  "lets a human review an AI payable proposal as %s",
  async (decision) => {
    data.banks[0].direction = "debit";
    data.titles[0].direction = "payable";
    data.titles[0].source_system = "custom";
    data.decisions.push({
      id: id(50),
      bank_entry_id: id(1),
      actor_id: id(98),
      origin: "ai",
      created_at: "2026-07-21T12:00:00Z",
      rationale: "Proposta por agente",
      disposition: "draft",
      review: null,
      reviewer_id: null,
      reviewed_at: null,
      rejected_title_id: null,
    });
    data.allocations = [
      { decision_id: id(50), title_id: id(10), amount_minor: 4278050 },
    ];
    mount();
    choose();
    expect(
      screen.getByText("Proposta por agente · aguardando aprovação humana"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Selecionar protheus NF 11" }),
    ).not.toBeInTheDocument();
    if (decision === "confirmed") {
      click("Confirmar conciliação");
      expect(fetchMock).not.toHaveBeenCalled();
      click("Confirmar e registrar");
    } else {
      click("Rejeitar proposta");
    }
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/reconciliation/decisions/${id(50)}/review`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision }),
      }),
    );
  },
);

it("rejects suggestions without changing balances and reports failed writes without losing edits", async () => {
  mount();
  choose();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Rejeitar sugestão" })[0],
  );
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
    action: "rejected_suggestion",
    rejectedTitleId: id(10),
  });
  select(10);
  fetchMock.mockResolvedValue(new Response(null, { status: 409 }));
  click("Salvar rascunho");
  await screen.findByText("Operação não concluída");
  expect(screen.getByLabelText("Alocar NF 10")).toHaveValue("42780,50");
});

it("validates exact decimal money and does not conflate unrelated titles", () => {
  expect(parseAllocation("47630,50")).toBe(4763050);
  expect(parseAllocation("9007199254740992")).toBeNaN();
  expect(parseAllocation("42.780,50")).toBeNaN();
  expect(overlaps(data.titles[3], data.titles)).toBe(true);
  expect(overlaps(data.titles[0], data.titles)).toBe(false);
});

it("shows loading and failure feedback for the database request", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
  render(
    <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
      <ReconciliationScreen />
    </WorkspaceProvider>,
  );
  expect(screen.getByLabelText("Carregando conciliação")).toBeInTheDocument();
  await screen.findByText("Não foi possível carregar a conciliação");
});

it("loads the page from database responses and refreshes after a recoverable read failure", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementation(async () => Response.json(data));
  render(
    <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
      <ReconciliationPage />
    </WorkspaceProvider>,
  );
  await screen.findByText("Não foi possível carregar a conciliação");
  click("Tentar novamente");
  await screen.findByRole("heading", { name: "Conciliação bancária" });
  click("Atualizar saldos");
  await waitFor(() =>
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3),
  );
});

it("filters both tables, supports mobile steps, and explicitly discards edits only after approval", () => {
  mount();
  choose();
  select(10);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  select(10);
  expect(screen.queryByLabelText("Alocar NF 10")).not.toBeInTheDocument();
  click("1. Selecionar crédito");
  click("TED DOCE PONTO");
  click("BELA VISTA");
  click("Descartar e trocar");
  expect(screen.queryByLabelText("Alocar NF 10")).not.toBeInTheDocument();
  click("Revisar alocação");
  expect(
    screen.getByRole("region", { name: "3. Resumo da alocação" }),
  ).not.toHaveClass("hidden");
  fireEvent.change(screen.getByLabelText("Buscar título"), {
    target: { value: "grao" },
  });
  expect(
    screen.queryByRole("checkbox", { name: "Selecionar protheus NF 10" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Selecionar omie NF 14" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Buscar título"), {
    target: { value: "not found" },
  });
  expect(screen.getByText(/Nenhum título encontrado/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Buscar crédito"), {
    target: { value: "not found" },
  });
  expect(
    screen.getByText(/Nenhum lançamento neste filtro/),
  ).toBeInTheDocument();
});

it("separates confirmed, partial, pending and exception records", () => {
  data.banks[0].unallocated_minor = 0;
  data.banks[1].unallocated_minor = 100;
  data.decisions = [
    {
      id: id(50),
      bank_entry_id: id(3),
      actor_id: id(99),
      created_at: "2026-07-21T12:00:00Z",
      rationale: "Pendente",
      disposition: "pending",
      review: null,
      reviewer_id: null,
      reviewed_at: null,
      rejected_title_id: null,
    },
  ];
  mount();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Confirmadas" }), {
    button: 0,
  });
  expect(
    screen.getByRole("button", { name: "TED DOCE PONTO" }),
  ).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Parciais" }), {
    button: 0,
  });
  expect(
    screen.getByRole("button", { name: "BELA VISTA" }),
  ).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Exceções" }), {
    button: 0,
  });
  expect(
    screen.getByRole("button", { name: "DEPOSITO NAO IDENTIFICADO" }),
  ).toBeInTheDocument();
});

it("retries provenance reads and renders original file links and audited decisions", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(
      Response.json({
        normalized: { document_ref: null, currency: "BRL" },
        source: {
          locator: "record:3",
          raw_text: "source row",
          object_ref: "original.csv",
          source_version: "v1",
          ingestion_id: id(80),
          filename: null,
        },
        history: [
          {
            id: id(50),
            actor_id: id(99),
            created_at: "2026-07-21T12:00:00Z",
            rationale: "Alocação revisada",
            disposition: "draft",
            review: "confirmed",
            reviewer_id: id(98),
            reviewed_at: "2026-07-22T12:00:00Z",
          },
        ],
      }),
    );
  mount();
  fireEvent.click(screen.getAllByRole("button", { name: "Doce Ponto" })[0]);
  await screen.findByText("Não foi possível abrir os detalhes");
  click("Tentar novamente");
  await screen.findByText("Alocação revisada");
  expect(
    screen.getByRole("link", { name: "Baixar arquivo original" }),
  ).toHaveAttribute("href", `/api/imports/${id(80)}/file`);
  click("Fechar");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("blocks self review, handles rejected proposals, and retains a draft after a failed confirmation", async () => {
  data.decisions = [
    {
      id: id(50),
      bank_entry_id: id(1),
      actor_id: id(98),
      created_at: "2026-07-21T12:00:00Z",
      rationale: "Proposta",
      disposition: "draft",
      review: null,
      reviewer_id: null,
      reviewed_at: null,
      rejected_title_id: null,
    },
  ];
  data.allocations = [
    { decision_id: id(50), title_id: id(10), amount_minor: 4278050 },
  ];
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValue(Response.json({ id: id(50) }));
  mount();
  choose();
  click("Confirmar conciliação");
  click("Confirmar e registrar");
  await screen.findByText("Operação não concluída");
  expect(screen.getByLabelText("Alocar NF 10")).toHaveValue("42780,50");
  click("Rejeitar proposta");
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.getByRole("status")).toHaveTextContent("Proposta rejeitada");
});

it("restores the operator's draft without granting self-confirmation", () => {
  data.decisions = [
    {
      id: id(50),
      bank_entry_id: id(1),
      actor_id: data.actorId,
      created_at: "2026-07-21T12:00:00Z",
      rationale: "Proposta",
      disposition: "draft",
      review: null,
      reviewer_id: null,
      reviewed_at: null,
      rejected_title_id: null,
    },
  ];
  data.allocations = [
    { decision_id: id(50), title_id: id(10), amount_minor: 4278050 },
  ];
  mount();
  choose();
  expect(screen.getByText(/Você propôs este rascunho/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Confirmar conciliação" }),
  ).toBeDisabled();
});

it("filters systems and allows debit selection in the bank-entry view", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  data.banks.push({
    ...data.banks[0],
    id: id(4),
    direction: "debit",
    description: "TARIFA BANCÁRIA",
  });
  mount();
  fireEvent.keyDown(
    screen.getByRole("combobox", { name: "Sistema de origem" }),
    { key: "ArrowDown" },
  );
  fireEvent.click(await screen.findByRole("option", { name: "Omie" }));
  expect(
    screen.queryByRole("checkbox", { name: "Selecionar protheus NF 10" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Visão bancária" }), {
    key: "ArrowDown",
  });
  fireEvent.click(
    await screen.findByRole("option", {
      name: "Lançamentos bancários · inclui débitos",
    }),
  );
  expect(screen.getByRole("button", { name: "TARIFA BANCÁRIA" })).toBeEnabled();
  expect(screen.getByText("Débito · Pendentes")).toBeInTheDocument();
});
