import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { fireEvent, render, screen } from "./render";
import { locales } from "@/i18n/config";
import { useServerMessage } from "@/i18n/server-messages";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { UsersScreen } from "@/components/users-screen";
import { NewUserScreen } from "@/components/new-user-screen";
import { DestinationsScreen } from "@/components/destinations-screen";
import { ImportsScreen } from "@/components/imports-screen";
import { ImportDetail } from "@/components/import-detail";
import { AccountScreen } from "@/components/account-screen";
import NotFound from "@/app/not-found";
import { admin, other } from "./fixtures";
import { importer, job, sourceRow } from "./import-fixtures";
import en from "../messages/en.json";
import ptBR from "../messages/pt-BR.json";
import es from "../messages/es.json";

const catalogs = { en, "pt-BR": ptBR, es };
let selectedLocale: (typeof locales)[number] = "en";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: selectedLocale,
      messages: catalogs[selectedLocale],
      namespace: "notFound",
    }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input === "/api/me")
        return Response.json({
          ...admin,
          permissions: [...admin.permissions, ...importer.permissions],
        });
      if (input === "/api/users/roles")
        return Response.json([{ role: "admin", permissions: ["configure"] }]);
      if (input.startsWith("/api/users"))
        return Response.json([{ ...other, roles: ["admin"] }]);
      if (input.includes("/rows?"))
        return Response.json([
          { ...sourceRow, state: "rejected", error: "Missing due_on" },
        ]);
      if (input === `/api/imports/${job.id}`)
        return Response.json({
          ...job,
          state: "completed",
          processed: 1,
          rejected: 1,
        });
      if (input.startsWith("/api/imports?")) return Response.json([job]);
      return Response.json([]);
    }),
  );
});

for (const locale of locales) {
  const m = catalogs[locale];
  const show = (ui: React.ReactNode) =>
    render(
      <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
        {ui}
      </WorkspaceProvider>,
      { locale },
    );

  it(`renders user management and its editor in ${locale}`, async () => {
    show(<UsersScreen />);
    expect(await screen.findByText(m.ui.userManagement)).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", {
        name: m.ui.editUserLabel.replace("{email}", other.email),
      }),
    );
    expect(await screen.findByText(m.ui.editUser)).toBeInTheDocument();
    expect(await screen.findByLabelText(m.ui.rolesList.admin)).toBeChecked();
  });

  it(`renders the new-user page in ${locale}`, async () => {
    show(<NewUserScreen />);
    expect(await screen.findByText(m.ui.newUser)).toBeInTheDocument();
    expect(
      await screen.findByLabelText(m.ui.initialPassword),
    ).toBeInTheDocument();
  });

  for (const kind of ["business-units", "bank-accounts"] as const) {
    it(`renders ${kind} and creation dialog in ${locale}`, async () => {
      show(<DestinationsScreen kind={kind} />);
      const label =
        kind === "business-units" ? m.ui.createUnit : m.ui.createAccount;
      fireEvent.click(await screen.findByRole("button", { name: label }));
      expect(screen.getByRole("dialog", { name: label })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: m.ui.close }),
      ).toBeInTheDocument();
    });
  }

  it(`renders import history, upload validation, and assistant in ${locale}`, async () => {
    show(<ImportsScreen />);
    expect(await screen.findByText(job.filename)).toBeInTheDocument();
    expect(screen.getByText(m.imports.states.mapping)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.imports.newImport }));
    fireEvent.change(screen.getByLabelText(m.imports.sourceFile), {
      target: { files: [new File(["bad"], "bad.pdf")] },
    });
    expect(screen.getByText(m.imports.fileValidation)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.ui.cancel }));
    fireEvent.click(screen.getByRole("button", { name: m.assistant.label }));
    expect(screen.getByText(m.assistant.welcome)).toBeInTheDocument();
  });

  it(`renders import corrections and preserves source text in ${locale}`, async () => {
    show(<ImportDetail id={job.id} />);
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: createTranslator({ locale, messages: m })("imports.correctRow", {
          number: 2,
        }),
      }),
    );
    expect(
      screen.getByRole("button", { name: m.imports.saveCorrection }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Customer")).toHaveValue("Acme");
  });

  it(`renders account and missing-page content in ${locale}`, async () => {
    const view = show(<AccountScreen />);
    expect(await screen.findByText(admin.email)).toBeInTheDocument();
    view.unmount();
    selectedLocale = locale;
    render(await NotFound(), { locale });
    expect(
      screen.getByRole("heading", { name: m.notFound.title }),
    ).toBeInTheDocument();
  });

  it(`localizes legacy errors and evidence while preserving unknown text in ${locale}`, () => {
    const inputs = [
      "Missing due_on",
      "Missing custom_field",
      "Invalid due_on date",
      "Invalid custom_field date",
      "Referência coincidente: NF 001",
      "CNPJ identificado: 123",
      "Nome no histórico: Acme",
      "Valor coincidente",
      "Original user text",
    ];
    function Messages() {
      const translate = useServerMessage();
      return (
        <>
          {inputs.map((input) => (
            <p key={input}>{translate(input)}</p>
          ))}
        </>
      );
    }
    render(<Messages />, { locale });
    const t = createTranslator({
      locale,
      messages: m,
      namespace: "serverMessages",
    });
    expect(
      screen.getByText(t("missingField", { field: m.imports.fields.due_on })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("invalidDate", { field: "custom_field" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("matchingReference", { value: "NF 001" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("identifiedTaxId", { value: "123" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("nameInDescription", { value: "Acme" })),
    ).toBeInTheDocument();
    expect(screen.getByText("Original user text")).toBeInTheDocument();
  });
}
