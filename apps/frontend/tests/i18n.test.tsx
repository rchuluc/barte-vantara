import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleSelector } from "@/components/locale-selector";
import { Loading, RequestError } from "@/components/request-feedback";
import { LoginScreen } from "@/components/login-screen";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { setLocale } from "@/i18n/actions";
import { defaultLocale, isLocale, localeCookie, locales } from "@/i18n/config";
import requestConfig from "@/i18n/request";
import en from "../messages/en.json";
import ptBR from "../messages/pt-BR.json";
import es from "../messages/es.json";

const cookie = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const readCookies = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ cookies: readCookies }));
vi.mock("next-intl/server", () => ({
  getRequestConfig: (factory: unknown) => factory,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const catalogs = { "pt-BR": ptBR, en, es };

beforeEach(() => {
  cookie.get.mockReset();
  cookie.set.mockReset();
  readCookies.mockReset().mockResolvedValue(cookie);
});

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "PT_BR", "fr", "../../en", ""])(
  "defaults to pt-BR for an absent or invalid preference (%s)",
  async (value) => {
    cookie.get.mockReturnValue(value === undefined ? undefined : { value });
    const config = await requestConfig({
      requestLocale: Promise.resolve(undefined),
    });

    expect(defaultLocale).toBe("pt-BR");
    expect(config.locale).toBe("pt-BR");
    expect(config.messages).toEqual(ptBR);
    expect(cookie.get).toHaveBeenCalledWith(localeCookie);
  },
);

it.each(locales)("loads the selected %s catalog", async (locale) => {
  cookie.get.mockReturnValue({ value: locale });

  expect(isLocale(locale)).toBe(true);
  expect(
    await requestConfig({ requestLocale: Promise.resolve(undefined) }),
  ).toMatchObject({
    locale,
    messages: catalogs[locale],
  });
});

it.each(["development", "production"])(
  "persists an explicit choice in %s",
  async (environment) => {
    vi.stubEnv("NODE_ENV", environment);

    await setLocale("es");

    expect(cookie.set).toHaveBeenCalledExactlyOnceWith(localeCookie, "es", {
      path: "/",
      maxAge: 31536000,
      httpOnly: true,
      sameSite: "lax",
      secure: environment === "production",
    });
  },
);

it("rejects unsupported values before writing cookies", async () => {
  await expect(setLocale("fr")).rejects.toThrow("Unsupported locale");
  expect(cookie.set).not.toHaveBeenCalled();
  expect(isLocale(null)).toBe(false);
});

it.each(locales)("renders translated sign-in and feedback for %s", (locale) => {
  const messages = catalogs[locale];

  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
        <LoginScreen />
        <Loading />
        <RequestError error={new Error("API detail")} retry={vi.fn()} />
      </WorkspaceProvider>
    </NextIntlClientProvider>,
  );

  expect(
    screen.getByRole("heading", { name: messages.login.welcome }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(messages.login.email)).toBeInTheDocument();
  expect(screen.getByLabelText(messages.login.password)).toHaveAttribute(
    "type",
    "password",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    messages.feedback.loading,
  );
  expect(
    screen.getByRole("button", { name: messages.feedback.retry }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: messages.language.label }),
  ).toHaveValue(locale);
});

it("saves a selection, disables it while saving, and displays a recoverable failure", async () => {
  let rejectSave: (error: Error) => void = () => {};
  cookie.set.mockImplementationOnce(() => {
    throw new Error("Cookie write failed");
  });

  render(
    <NextIntlClientProvider locale="pt-BR" messages={ptBR}>
      <LocaleSelector />
    </NextIntlClientProvider>,
  );
  const select = screen.getByRole("combobox", { name: "Idioma" });

  fireEvent.change(select, { target: { value: "es" } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    ptBR.language.error,
  );
  await waitFor(() => expect(select).toBeEnabled());
  expect(select).toHaveValue("pt-BR");

  // Hold the cookie read so the pending state is observable.
  const pendingRead = new Promise<never>((_, reject) => {
    rejectSave = reject;
  });
  readCookies.mockReturnValueOnce(pendingRead);

  fireEvent.change(select, { target: { value: "en" } });
  expect(select).toBeDisabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  rejectSave(new Error("Offline"));
  await waitFor(() => expect(select).toBeEnabled());

  fireEvent.change(select, { target: { value: "en" } });
  await waitFor(() =>
    expect(cookie.set).toHaveBeenLastCalledWith(
      localeCookie,
      "en",
      expect.any(Object),
    ),
  );
  await waitFor(() => expect(select).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps catalog keys and interpolation variables aligned and renders every message", () => {
  function flatten(
    object: Record<string, unknown>,
    prefix = "",
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(object).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof value === "string"
          ? [[path, value]]
          : Object.entries(flatten(value as Record<string, unknown>, path));
      }),
    );
  }

  const reference = flatten(en);
  const variables = (message: string) =>
    Array.from(
      message.matchAll(/\{(\w+)(?:,\s*(number|plural|selectordinal))?[,}]/g),
      ([, name, numeric]) => [name, numeric ? 2 : "Example"] as const,
    );

  for (const locale of locales) {
    const t = createTranslator({
      locale,
      messages: catalogs[locale],
      onError: (error) => {
        throw error;
      },
    });

    const messages = flatten(catalogs[locale]);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort());

    for (const [path, message] of Object.entries(messages)) {
      expect(
        variables(message)
          .map(([name]) => name)
          .sort(),
        path,
      ).toEqual(
        variables(reference[path])
          .map(([name]) => name)
          .sort(),
      );
      expect(
        t(
          path as Parameters<typeof t>[0],
          Object.fromEntries(variables(message)),
        ),
        path,
      ).not.toBe(path);
    }
  }
});
