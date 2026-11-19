"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/i18n/actions";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export function LocaleSelector() {
  const locale = useLocale();
  const t = useTranslations("language");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <NativeSelect
        aria-label={t("label")}
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value;
          setFailed(false);
          startTransition(async () => {
            try {
              await setLocale(value);
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        <NativeSelectOption value="pt-BR" lang="pt-BR">
          Português (Brasil)
        </NativeSelectOption>
        <NativeSelectOption value="en" lang="en">
          English
        </NativeSelectOption>
        <NativeSelectOption value="es" lang="es">
          Español
        </NativeSelectOption>
      </NativeSelect>
      {failed && <p role="alert">{t("error")}</p>}
    </div>
  );
}
