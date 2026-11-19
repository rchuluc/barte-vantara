import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import ptBR from "../messages/pt-BR.json";
import es from "../messages/es.json";
import type { Locale } from "@/i18n/config";

export * from "@testing-library/react";

export function render(
  ui: React.ReactNode,
  options?: RenderOptions & { locale?: Locale },
) {
  const { locale = "en", wrapper: Wrapper, ...rest } = options ?? {};
  const catalogs = { en: messages, "pt-BR": ptBR, es };

  return testingLibraryRender(ui, {
    ...rest,
    wrapper: ({ children }) => (
      <NextIntlClientProvider
        locale={locale}
        messages={catalogs[locale]}
        timeZone="UTC"
        onError={(error) => {
          throw error;
        }}
      >
        {Wrapper ? <Wrapper>{children}</Wrapper> : children}
      </NextIntlClientProvider>
    ),
  });
}
