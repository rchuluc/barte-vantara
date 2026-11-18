import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/components/workspace-provider";
import {
  BusinessUnitCombobox,
  BankAccountCombobox,
  BusinessUnitDialog,
  BankAccountDialog,
} from "@/components/destination-picker";
import NewUserPage from "@/app/[tenant]/(workspace)/users/new/page";
import UnitsPage from "@/app/[tenant]/(workspace)/business-units/page";
import AccountsPage from "@/app/[tenant]/(workspace)/bank-accounts/page";
import { admin, member, other } from "./fixtures";
import type { BankAccount, BusinessUnit } from "@/lib/destination-contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
const fetchMock = vi.fn<typeof fetch>();
const unitId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
let units: BusinessUnit[];
let accounts: BankAccount[];
let identity = admin;
let fail = false;

function mount(node: React.ReactNode) {
  return render(
    <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
      {node}
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  identity = admin;
  fail = false;
  units = [
    { id: unitId, name: "Head office", active: true },
    { id: other.id, name: "Closed branch", active: false },
  ];
  accounts = [
    {
      id: accountId,
      unit_ids: [unitId],
      configurable: true,
      bank_code: "341",
      account_ref: "123",
      currency: "BRL",
      active: true,
    },
  ];
  fetchMock.mockReset().mockImplementation(async (url, options) => {
    const path = String(url);
    if (path.endsWith("/me")) return Response.json(identity);
    if (fail) return new Response(null, { status: 409 });
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path.includes("business-units")) {
      if (options?.method === "POST") {
        const unit = { id: crypto.randomUUID(), ...body, active: true };
        units.push(unit);
        return Response.json(unit);
      }
      if (options?.method === "PATCH") {
        units = units.map((unit) =>
          path.endsWith(unit.id) ? { ...unit, ...body } : unit,
        );
        return Response.json(units.find((unit) => path.endsWith(unit.id)));
      }
      return Response.json(units);
    }
    if (options?.method === "POST") {
      const account = {
        id: crypto.randomUUID(),
        unit_ids: body.unitIds,
        configurable: true,
        bank_code: body.bankCode,
        account_ref: body.accountRef,
        currency: body.currency,
        active: true,
      };
      accounts.push(account);
      return Response.json(account);
    }
    if (options?.method === "PATCH") {
      accounts = accounts.map((account) =>
        path.endsWith(account.id)
          ? {
              ...account,
              unit_ids: body.unitIds ?? account.unit_ids,
              bank_code: body.bankCode,
              account_ref: body.accountRef,
              active: body.active,
            }
          : account,
      );
      return Response.json(
        accounts.find((account) => path.endsWith(account.id)),
      );
    }
    return Response.json(accounts);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function UnitPicker() {
  const [value, onChange] = useState<string[]>([]);
  return (
    <>
      <BusinessUnitCombobox id="unit" value={value} onChange={onChange} />
      <output>{value.join(",")}</output>
    </>
  );
}

function AccountPicker() {
  const [value, onChange] = useState<string[]>([]);
  return (
    <BankAccountCombobox
      id="account"
      value={value}
      onChange={onChange}
      unitIds={[unitId]}
      currency="BRL"
    />
  );
}

it("searches active units, creates in a modal and selects the saved unit", async () => {
  mount(<UnitPicker />);
  const picker = screen.getByRole("combobox");
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  expect(
    screen.queryByRole("option", { name: "Closed branch" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Search…"), {
    target: { value: "North" },
  });
  expect(screen.getByText("No matches found.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Create Business Unit" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Create Business Unit",
  });
  fireEvent.change(within(dialog).getByLabelText("Name"), {
    target: { value: "North" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save business unit" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(picker).toHaveTextContent("North");
  expect(units.some((unit) => unit.name === "North")).toBe(true);
});

it("creates an account for the selected unit and currency and retains fields on failure", async () => {
  mount(<AccountPicker />);
  const picker = screen.getByRole("combobox");
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  fireEvent.click(
    await screen.findByRole("option", { name: "Create Bank Account" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Create Bank Account",
  });
  fireEvent.change(within(dialog).getByLabelText("Bank code"), {
    target: { value: "001" },
  });
  fireEvent.change(within(dialog).getByLabelText("Account reference"), {
    target: { value: "456" },
  });
  fail = true;
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save bank account" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("conflicts");
  expect(within(dialog).getByLabelText("Account reference")).toHaveValue("456");
  fail = false;
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save bank account" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(picker).toHaveTextContent("001 · 456 · BRL");
  expect(accounts.at(-1)).toMatchObject({
    unit_ids: [unitId],
    currency: "BRL",
  });
});

it("hides creation for members and filters accounts by active unit and currency", async () => {
  identity = member;
  accounts.push(
    { ...accounts[0], id: other.id, currency: "USD" },
    { ...accounts[0], id: other.tenant_id, active: false },
  );
  mount(<AccountPicker />);
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.click(screen.getByRole("combobox"));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.queryByText("Create Bank Account")).not.toBeInTheDocument();
});

it("lists, searches, updates and disables units with no delete action", async () => {
  mount(<UnitsPage />);
  const row = (await screen.findByText("Head office")).closest("tr")!;
  expect(
    screen.queryByRole("button", { name: /delete/i }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Update" }));
  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "Renamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save business unit" }));
  const updated = (await screen.findByText("Renamed")).closest("tr")!;
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(within(updated).getByRole("button", { name: "Disable" }));
  await waitFor(() =>
    expect(within(updated).getByText("Disabled")).toBeInTheDocument(),
  );
  expect(units).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Search records"), {
    target: { value: "nothing" },
  });
  expect(screen.getByText("No records found.")).toBeInTheDocument();
});

it("updates account coordinates while preserving unit and currency and disables it", async () => {
  mount(<AccountsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  expect(screen.getByLabelText("Business unit")).toBeEnabled();
  expect(screen.getByLabelText("Currency")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Account reference"), {
    target: { value: "changed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save bank account" }));
  await screen.findByText("341 · changed · BRL");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Disable" }));
  await screen.findByText("Disabled");
  expect(accounts[0]).toMatchObject({
    unit_ids: [unitId],
    currency: "BRL",
    active: false,
  });
});

it("restricts management pages to administrators", async () => {
  identity = member;
  mount(<AccountsPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Administrator access required",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("shares an existing account across units and displays one searchable account row", async () => {
  units[1] = { ...units[1], name: "North", active: true };
  mount(<AccountsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  fireEvent.click(screen.getByLabelText("Business unit"));
  const north = await screen.findByRole("option", { name: "North" });
  expect(north).toHaveAttribute("aria-checked", "false");
  expect(north.querySelector('[data-slot="checkbox"]')).toHaveAttribute(
    "data-state",
    "unchecked",
  );
  fireEvent.click(north);
  expect(north).toHaveAttribute("aria-checked", "true");
  expect(north.querySelector('[data-slot="checkbox"]')).toHaveAttribute(
    "data-state",
    "checked",
  );
  expect(screen.getByRole("listbox")).toHaveAttribute(
    "aria-multiselectable",
    "true",
  );
  fireEvent.click(screen.getByLabelText("Business unit"));
  fireEvent.click(screen.getByRole("button", { name: "Save bank account" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(accounts).toHaveLength(1);
  expect(accounts[0].unit_ids).toEqual([unitId, other.id]);
  fireEvent.change(screen.getByLabelText("Search records"), {
    target: { value: "North" },
  });
  expect(screen.getByText("Head office, North")).toBeInTheDocument();
});

it("offers a shared account when only its second unit matches the destination", async () => {
  accounts[0].unit_ids = [other.id, unitId];
  mount(<AccountPicker />);
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.click(screen.getByRole("combobox"));
  expect(
    screen.getAllByRole("option", { name: "341 · 123 · BRL" }),
  ).toHaveLength(1);
});

it("prevents global account changes when the administrator lacks full shared scope", async () => {
  accounts[0].configurable = false;
  mount(<AccountsPage />);
  expect(await screen.findByRole("button", { name: "Update" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
});

it("requires a shared account to cover every destination in a multi-unit import", async () => {
  units[1] = { ...units[1], active: true };
  accounts.push({
    ...accounts[0],
    id: other.id,
    account_ref: "shared",
    unit_ids: [unitId, other.id],
  });
  mount(
    <BankAccountCombobox
      id="import"
      value={[]}
      onChange={vi.fn()}
      unitIds={[unitId, other.id]}
      requireAllUnits
    />,
  );
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.click(screen.getByRole("combobox"));
  expect(
    screen.getByRole("option", { name: "341 · shared · BRL" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "341 · 123 · BRL" }),
  ).not.toBeInTheDocument();
});

it("paginates, sorts and resets filtering on management tables", async () => {
  units = Array.from({ length: 21 }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Unit ${String(index).padStart(2, "0")}`,
    active: true,
  }));
  mount(<UnitsPage />);
  await screen.findByText("Unit 00");
  expect(screen.queryByText("Unit 20")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Unit 20")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Unit 20");
  fireEvent.click(screen.getByRole("button", { name: "Create Business Unit" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("creates a bank account from its management page using a searchable unit", async () => {
  mount(<AccountsPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Bank Account" }),
  );
  fireEvent.click(screen.getByLabelText("Business unit"));
  fireEvent.click(await screen.findByRole("option", { name: "Head office" }));
  fireEvent.click(screen.getByLabelText("Business unit"));
  fireEvent.change(screen.getByLabelText("Bank code"), {
    target: { value: "001" },
  });
  fireEvent.change(screen.getByLabelText("Account reference"), {
    target: { value: "new" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save bank account" }));
  await screen.findByText("001 · new · BRL");
  expect(accounts).toHaveLength(2);
});

it.each([UnitsPage, AccountsPage])(
  "retries unavailable management lists",
  async (Page) => {
    fail = true;
    mount(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent("conflicts");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  },
);

it.each([UnitsPage, NewUserPage])(
  "shows identity failures without fetching protected records",
  async (Page) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    mount(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it("denies the new-user route for members", async () => {
  identity = member;
  mount(<NewUserPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Administrator access required",
  );
});

it.each(["unit", "account"])(
  "allows dismissing a %s modal without saving",
  async (kind) => {
    const close = vi.fn();
    mount(
      kind === "unit" ? (
        <BusinessUnitDialog close={close} saved={vi.fn()} />
      ) : (
        <BankAccountDialog close={close} saved={vi.fn()} unitIds={[unitId]} />
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
  },
);

it("supports multi-selection, removing disabled access, and selecting a newly created unit", async () => {
  function MultiPicker() {
    const [value, onChange] = useState([other.id]);
    return (
      <BusinessUnitCombobox
        id="multi"
        value={value}
        onChange={onChange}
        multiple
      />
    );
  }
  mount(<MultiPicker />);
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(
    screen.getByRole("option", { name: /Closed branch \(disabled\)/ }),
  );
  expect(
    screen.queryByText("Closed branch (disabled)"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Head office" }));
  fireEvent.click(screen.getByRole("option", { name: "Create Business Unit" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Additional" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save business unit" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("combobox")).toHaveTextContent(
    "Head office, Additional",
  );
});

it("retries picker lookups and cancels account creation", async () => {
  fail = true;
  mount(<AccountPicker />);
  await screen.findAllByRole("alert");
  fail = false;
  for (const button of screen.getAllByRole("button", { name: "Try again" }))
    fireEvent.click(button);
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Create Bank Account" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
