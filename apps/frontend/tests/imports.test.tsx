import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "./render";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { ImportDetail } from "@/components/import-detail";
import { ImportUpload } from "@/components/import-upload";
import { ImportMappingForm } from "@/components/import-mapping";
import ImportsPage from "@/app/[tenant]/(workspace)/imports/page";
import ImportPage from "@/app/[tenant]/(workspace)/imports/[id]/page";
import type { ImportJob, ImportRow } from "@/lib/import-contracts";
import { MAX_IMPORT_BYTES } from "@/lib/import-contracts";
import {
  job as initialJob,
  importer,
  importId,
  unitId,
  sourceRow,
} from "./import-fixtures";
import { member } from "./fixtures";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  notFound: () => {
    throw new Error("Not found");
  },
}));
const fetchMock = vi.fn<typeof fetch>();
let job: ImportJob;
let rows: ImportRow[];
let history: ImportJob[];
let identity = importer;
let failure: string | undefined;
const secondUnit = "00000000-0000-4000-8000-000000000002";

function mount(node: React.ReactNode) {
  return render(
    <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
      {node}
    </WorkspaceProvider>,
  );
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

async function selectDestination(label: string, name: string) {
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  job = structuredClone(initialJob);
  rows = [structuredClone(sourceRow)];
  history = [job];
  identity = importer;
  failure = undefined;
  navigation.push.mockReset();
  fetchMock.mockReset().mockImplementation(async (url, options) => {
    const path = String(url);
    if (failure && path.includes(failure))
      return new Response(null, { status: 503 });
    if (path === "/api/me") return Response.json(identity);
    if (path.includes("/imports/preview?"))
      return Response.json({ ...job, rows });
    if (path === "/api/business-units")
      return Response.json([
        { id: unitId, name: "Head office", active: true },
        { id: secondUnit, name: "Branch", active: true },
      ]);
    if (path === "/api/bank-accounts")
      return Response.json([
        {
          id: unitId,
          unit_ids: [unitId, secondUnit],
          configurable: true,
          bank_code: "341",
          account_ref: "123",
          currency: "BRL",
          active: true,
        },
      ]);
    if (path.includes("/rows?"))
      return Response.json(path.includes("after=0&") ? rows : []);
    if (path.includes("/rows/")) {
      rows[0] = {
        ...rows[0],
        corrected_cells: JSON.parse(String(options?.body)),
        state: "pending",
        error: null,
      };
      job = { ...job, state: "processing", processed: 0, rejected: 0 };
      return Response.json(job);
    }
    if (path.endsWith("/confirm")) {
      job = { ...job, state: "processing" };
      return Response.json(job);
    }
    if (path.endsWith("/process")) {
      job = { ...job, state: "completed", processed: 1 };
      rows[0] = { ...rows[0], state: "accepted", result_id: unitId };
      return Response.json(job);
    }
    if (path.endsWith("/prepare")) {
      job = { ...job, state: "mapping" };
      return Response.json(job);
    }
    if (path.includes("/imports?") && options?.method === "POST")
      return Response.json(job);
    if (path.includes("/imports?"))
      return Response.json(path.includes("offset=0&") ? history : []);
    return Response.json(job);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("lists imports, links to details and preserves paginated history", async () => {
  history = Array.from({ length: 20 }, (_, index) => ({
    ...job,
    id: `${job.id.slice(0, -2)}${String(index).padStart(2, "0")}`,
    filename: `file-${index}.csv`,
    state: index === 0 ? "failed" : "mapping",
    platform: index === 0 ? null : "custom",
    rejected: index === 0 ? 1 : 0,
  }));
  mount(<ImportsPage />);
  expect(
    await screen.findByRole("link", { name: "file-0.csv" }),
  ).toHaveAttribute("href", `/imports/${history[0].id}`);
  click("Refresh");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next imports" })).toBeEnabled(),
  );
  click("Next imports");
  expect(await screen.findByText("No more imports")).toBeInTheDocument();
  click("Previous imports");
  expect(await screen.findByText("file-0.csv")).toBeInTheDocument();
});

it("shows the first-import empty state and recovers a failed history request", async () => {
  history = [];
  failure = "/imports?";
  mount(<ImportsPage />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  failure = undefined;
  click("Try again");
  expect(
    await screen.findByText("Your first import starts here"),
  ).toBeInTheDocument();
});

it("explains read-only access without offering upload", async () => {
  identity = member;
  history = [];
  mount(<ImportsPage />);
  expect(await screen.findByText(/Ask your administrator/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New import" }),
  ).not.toBeInTheDocument();
});

it("uploads through the hook and service, using raw bytes and stable keys on retry", async () => {
  mount(<ImportsPage />);
  click(
    await screen
      .findByRole("button", { name: "New import" })
      .then((button) => button.textContent!),
  );
  fill("Dataset", "payable");
  const file = new File(["Customer,Amount\nAcme,10"], "data.csv", {
    type: "text/csv",
  });
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [file] },
  });
  failure = "/imports/preview?";
  fireEvent.submit(screen.getByLabelText("Source file").closest("form")!);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  const first = fetchMock.mock.calls.find(
    ([, options]) => options?.body === file,
  )!;
  failure = undefined;
  fireEvent.submit(screen.getByLabelText("Source file").closest("form")!);
  await waitFor(() =>
    expect(navigation.push).toHaveBeenCalledWith(`/imports/${importId}`),
  );
  const uploads = fetchMock.mock.calls.filter(
    ([, options]) => options?.body === file,
  );
  expect(uploads).toHaveLength(2);
  expect(uploads[1][1]?.headers).toEqual(first[1]?.headers);
  expect(first[0]).toContain("kind=payable");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("validates file selection and allows cancelling and reopening", async () => {
  mount(<ImportUpload kinds={["bank"]} onUploaded={vi.fn()} />);
  click("New import");
  const input = screen.getByLabelText("Source file");
  for (const file of [
    new File(["x"], "bad.exe"),
    new File([], "empty.csv"),
    new File(["x"], "a".repeat(201) + ".csv"),
  ]) {
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a nonempty CSV",
    );
    expect(screen.getByRole("button", { name: "Preview file" })).toBeDisabled();
  }
  const large = new File(["x"], "large.csv");
  Object.defineProperty(large, "size", { value: MAX_IMPORT_BYTES + 1 });
  fireEvent.change(input, { target: { files: [large] } });
  fireEvent.change(input, { target: { files: [] } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  click("Cancel");
  click("New import");
  click("Close");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("maps a file, processes records and reports completion", async () => {
  mount(await ImportPage({ params: Promise.resolve({ id: importId }) }));
  expect(await screen.findByText("Review column mapping")).toBeInTheDocument();
  await selectDestination("Business unit *", "Head office");
  fill("Amount *", "Amount");
  fill("Date format", "dd/MM/uuuu");
  fill("Decimal separator", ",");
  fill("Currency", "USD");
  click("Confirm and import");
  await screen.findByRole("progressbar");
  const confirm = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/confirm"),
  );
  expect(JSON.parse(String(confirm?.[1]?.body))).toMatchObject({
    unitId,
    dateFormat: "dd/MM/uuuu",
    decimal: ",",
    currency: "USD",
  });
  expect(await screen.findByText("Processing complete")).toBeInTheDocument();
  expect(await screen.findByText(`Record: ${unitId}`)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Refresh status" }),
  ).not.toBeInTheDocument();
});

it("recovers preparation and detail errors", async () => {
  failure = `/imports/${importId}`;
  mount(<ImportDetail id={importId} />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  job = { ...job, state: "failed", platform: null };
  failure = undefined;
  click("Try again");
  expect(
    await screen.findByText("File preparation needs attention"),
  ).toBeInTheDocument();
  failure = "/prepare";
  click("Retry preparation");
  expect(
    await screen.findByText(/temporarily unavailable/),
  ).toBeInTheDocument();
  failure = undefined;
  click("Retry preparation");
  expect(await screen.findByText("Review column mapping")).toBeInTheDocument();
});

it("renders interrupted upload recovery", async () => {
  job.state = "uploading";
  mount(<ImportDetail id={importId} />);
  expect(
    await screen.findByRole("button", { name: "Retry preparation" }),
  ).toBeEnabled();
});

it("surfaces mapping failures and allows retrying business unit lookup", async () => {
  failure = "business-units";
  mount(<ImportMappingForm job={job} />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  failure = undefined;
  click("Try again");
  await selectDestination("Business unit *", "Head office");
  failure = "/confirm";
  click("Confirm and import");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it("supports bank destination and custom multi-unit mappings", async () => {
  job = {
    ...job,
    dataset_kind: "bank",
    platform: "itau",
    targetFields: [
      "amount",
      "booking_date",
      "description",
      "direction",
      "unit",
    ],
    suggestedColumns: {},
  };
  mount(<ImportMappingForm job={job} />);
  fill("Business unit", "Customer");
  fill("Source unit names *", "HQ");
  await selectDestination("Destination for HQ *", "Head office");
  await selectDestination("Bank account *", "341 · 123 · BRL");
  fill("Amount *", "Amount");
  fill("Booking date *", "Due date");
  fill("Description *", "Customer");
  fill("Direction *", "Customer");
  click("Confirm and import");
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("confirm")),
    ).toBe(true),
  );
  const body = JSON.parse(
    String(
      fetchMock.mock.calls.find(([url]) => String(url).endsWith("confirm"))?.[1]
        ?.body,
    ),
  );
  expect(body).toMatchObject({
    units: { HQ: unitId },
    accountId: unitId,
    dateFormat: "dd/MM/uuuu",
    decimal: ",",
  });
});

it("uses Protheus unit matching and permits unmapping optional fields", async () => {
  job = {
    ...job,
    platform: "protheus",
    suggestedColumns: { ...job.suggestedColumns, unit: "Customer" },
  };
  mount(<ImportMappingForm job={job} />);
  expect(screen.getByText(/Protheus unit names/)).toBeInTheDocument();
  click("Confirm and import");
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("confirm")),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Business unit")).toBeEnabled(),
  );
  fill("Business unit", "");
  expect(screen.getByLabelText("Business unit *")).toBeInTheDocument();
});

it("corrects rejected rows, retains edits on errors, and processes them again", async () => {
  job = { ...job, state: "completed", processed: 1, rejected: 1 };
  rows = [
    {
      ...sourceRow,
      cells: ["Acme", "bad"],
      state: "rejected",
      error: "Invalid amount",
    },
  ];
  mount(<ImportDetail id={importId} />);
  await screen.findByRole("button", { name: "Correct row 2" });
  click("Correct row 2");
  fill("Amount", "25.00");
  fill("Due date", "2026-12-01");
  failure = "/rows/2";
  click("Save correction");
  expect(
    await within(screen.getByRole("dialog")).findByRole("alert"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Amount")).toHaveValue("25.00");
  failure = undefined;
  click("Save correction");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(await screen.findByText("25.00")).toBeInTheDocument();
  expect(
    await screen.findByText(
      "All records were accepted. Your imported data is ready.",
    ),
  ).toBeInTheDocument();
});

it("cancels row edits and handles a missing error message", async () => {
  job.state = "completed";
  rows = [{ ...sourceRow, corrected_cells: ["Corrected"], state: "rejected" }];
  mount(<ImportDetail id={importId} />);
  await screen.findByText("Corrected");
  click("Correct row 2");
  expect(screen.getByLabelText("Customer")).toHaveValue("Corrected");
  click("Cancel");
  click("Correct row 2");
  click("Close");
});

it("paginates records and recovers a failed row request", async () => {
  job.state = "completed";
  failure = "/rows?";
  rows = Array.from({ length: 20 }, (_, index) => ({
    ...sourceRow,
    row_number: index + 2,
  }));
  mount(<ImportDetail id={importId} />);
  await screen.findByRole("button", { name: "Try again" });
  failure = undefined;
  click("Try again");
  await screen.findByText("Page 1 · 20 records");
  click("Next records");
  expect(
    await screen.findByText("No records on this page."),
  ).toBeInTheDocument();
  click("Previous records");
  expect(await screen.findByText("Page 1 · 20 records")).toBeInTheDocument();
});

it("rejects invalid deep links before rendering", async () => {
  await expect(
    ImportPage({ params: Promise.resolve({ id: "invalid" }) }),
  ).rejects.toThrow("Not found");
});

it("automatically runs sequential batches and shows persisted progress in Strict Mode", async () => {
  job = { ...job, state: "processing", total: 1001 };
  const original = fetchMock.getMockImplementation()!;
  const batches: Array<(response: Response) => void> = [];
  fetchMock.mockImplementation((url, options) =>
    String(url).endsWith("/process")
      ? new Promise<Response>((resolve) => batches.push(resolve))
      : original(url, options),
  );
  mount(
    <StrictMode>
      <ImportDetail id={importId} />
    </StrictMode>,
  );

  await waitFor(() => expect(batches).toHaveLength(1));
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect(
    screen.queryByRole("button", { name: "Process next batch" }),
  ).not.toBeInTheDocument();
  await act(async () => batches[0](Response.json({ ...job, processed: 500 })));
  await waitFor(() => expect(batches).toHaveLength(2));
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "500");
  await act(async () => batches[1](Response.json({ ...job, processed: 1000 })));
  await waitFor(() => expect(batches).toHaveLength(3));
  await act(async () =>
    batches[2](Response.json({ ...job, state: "completed", processed: 1001 })),
  );
  expect(await screen.findByText("Processing complete")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1001");
  expect(batches).toHaveLength(3);
});

it("stops on a batch error and resumes only when retry is selected", async () => {
  job = { ...job, state: "processing" };
  failure = "/process";
  mount(<ImportDetail id={importId} />);
  await screen.findByText(/temporarily unavailable/);
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/process")),
  ).toHaveLength(1);
  failure = undefined;
  click("Try again");
  expect(await screen.findByText("Processing complete")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/process")),
  ).toHaveLength(2);
});

it("stops a successful response that makes no progress instead of looping forever", async () => {
  job = { ...job, state: "processing" };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, options) =>
    String(url).endsWith("/process")
      ? Promise.resolve(Response.json(job))
      : original(url, options),
  );
  mount(<ImportDetail id={importId} />);
  expect(
    await screen.findByText(/Processing made no progress/),
  ).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/process")),
  ).toHaveLength(1);
});

it("does not schedule another batch after leaving the detail page", async () => {
  job = { ...job, state: "processing", total: 1000 };
  const original = fetchMock.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation((url, options) =>
    String(url).endsWith("/process")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  const view = mount(<ImportDetail id={importId} />);
  await waitFor(() => expect(finish).toBeDefined());
  view.unmount();
  await act(async () => finish(Response.json({ ...job, processed: 500 })));
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/process")),
  ).toHaveLength(1);
});

it("completes an empty import with a full progress indicator", async () => {
  job = { ...job, state: "processing", total: 0 };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, options) =>
    String(url).endsWith("/process")
      ? Promise.resolve(Response.json({ ...job, state: "completed" }))
      : original(url, options),
  );
  mount(<ImportDetail id={importId} />);
  expect(await screen.findByText("Processing complete")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
});

function PreviewFlow() {
  const [id, setId] = useState<string>();

  return id ? (
    <ImportDetail id={id} />
  ) : (
    <ImportUpload kinds={["receivable"]} onUploaded={setId} />
  );
}

async function openPreview() {
  click("New import");
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: {
      files: [new File(["Name,Due,Total\nAcme,2026-12-01,10"], "preview.csv")],
    },
  });
  fireEvent.submit(screen.getByLabelText("Source file").closest("form")!);
  await screen.findByText("Review column mapping");
}

it("warns before refreshing a preview and removes the warning after discard", async () => {
  mount(<PreviewFlow />);
  await openPreview();
  const refresh = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(refresh);
  expect(refresh.defaultPrevented).toBe(true);
  expect(screen.getByText("Review column mapping")).toBeInTheDocument();
  click("All imports");
  click("Discard preview");
  const afterDiscard = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterDiscard);
  expect(afterDiscard.defaultPrevented).toBe(false);
});

it("recovers when a reload loses the temporary preview", async () => {
  const view = mount(<PreviewFlow />);
  await openPreview();
  view.unmount();
  fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
  mount(<ImportDetail id={importId} />);
  expect(await screen.findByText("Import unavailable")).toBeInTheDocument();
  expect(screen.getByText(/select your file again/)).toBeInTheDocument();
  click("Return to imports");
  expect(navigation.push).toHaveBeenCalledWith("/imports");
  expect(
    screen.queryByRole("button", { name: "Try again" }),
  ).not.toBeInTheDocument();
});

it("discards an unconfirmed preview without saving a file or import", async () => {
  mount(<PreviewFlow />);
  await openPreview();
  expect(await screen.findByText("Acme")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes(`/imports/${importId}`),
    ),
  ).toBe(false);
  click("All imports");
  expect(screen.getByRole("dialog")).toHaveTextContent("Discard this preview?");
  click("Stay here");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  click("All imports");
  click("Discard preview");
  expect(navigation.push).toHaveBeenCalledWith("/imports");
  expect(
    fetchMock.mock.calls.some(
      ([url, options]) =>
        String(url).startsWith("/api/imports?") && options?.method === "POST",
    ),
  ).toBe(false);
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm")),
  ).toBe(false);
});

it("persists the original only on Confirm and import, then processes it", async () => {
  mount(<PreviewFlow />);
  await openPreview();
  await selectDestination("Business unit *", "Head office");
  click("Confirm and import");
  expect(await screen.findByText("Processing complete")).toBeInTheDocument();
  const writes = fetchMock.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
  expect(writes.map(([url]) => String(url).split("?")[0])).toEqual([
    "/api/imports/preview",
    "/api/imports",
    `/api/imports/${importId}/confirm`,
    `/api/imports/${importId}/process`,
  ]);
  expect(writes[1][1]?.body).toBeInstanceOf(File);
  const refresh = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(refresh);
  expect(refresh.defaultPrevented).toBe(false);
  click("All imports");
  expect(screen.getByRole("dialog")).toHaveTextContent("Leave this import?");
  click("Back to imports");
  expect(navigation.push).toHaveBeenCalledWith("/imports");
});

it("uses the detected Itau bank dataset for mapping and persistence", async () => {
  job = {
    ...job,
    platform: "itau",
    dataset_kind: "bank",
    headers: ["data", "historico", "documento", "valor", "tipo"],
    suggestedColumns: {
      booking_date: "data",
      description: "historico",
      external_id: "documento",
      amount: "valor",
      direction: "tipo",
    },
    targetFields: [
      "booking_date",
      "description",
      "external_id",
      "amount",
      "direction",
    ],
  };
  mount(<PreviewFlow />);
  await openPreview();
  expect(screen.getByText(/Bank statements/)).toBeInTheDocument();
  expect(screen.getByLabelText("Booking date *")).toHaveValue("data");
  expect(screen.queryByLabelText("Due date *")).not.toBeInTheDocument();
  await selectDestination("Business unit *", "Head office");
  fireEvent.click(screen.getByRole("option", { name: "Branch" }));
  expect(screen.getByRole("option", { name: "Head office" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.getByRole("option", { name: "Branch" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  fireEvent.click(screen.getByLabelText("Business unit *"));
  await selectDestination("Bank account *", "341 · 123 · BRL");
  click("Confirm and import");
  await screen.findByText("Processing complete");
  const upload = fetchMock.mock.calls.find(([url]) =>
    String(url).startsWith("/api/imports?"),
  );
  expect(String(upload?.[0])).toContain("kind=bank");
  const confirmation = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/confirm"),
  );
  expect(JSON.parse(String(confirmation?.[1]?.body))).toMatchObject({
    unitIds: [unitId, secondUnit],
    accountId: unitId,
    dateFormat: "dd/MM/uuuu",
    decimal: ",",
  });
});

it("keeps a confirmed upload retryable if mapping confirmation fails", async () => {
  mount(<PreviewFlow />);
  await openPreview();
  await selectDestination("Business unit *", "Head office");
  failure = "/confirm";
  click("Confirm and import");
  await screen.findByText(/temporarily unavailable/);
  click("All imports");
  expect(screen.getByRole("dialog")).toHaveTextContent("Leave this import?");
  click("Stay here");
  failure = undefined;
  click("Confirm and import");
  expect(await screen.findByText("Processing complete")).toBeInTheDocument();
  const uploads = fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/imports?"),
  );
  expect(uploads).toHaveLength(2);
  expect(uploads[0][1]?.headers).toEqual(uploads[1][1]?.headers);
});
