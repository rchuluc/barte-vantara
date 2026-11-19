"use client";

import { useTranslations } from "next-intl";
import { useServerMessage } from "@/i18n/server-messages";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function RequestError({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  const t = useTranslations("feedback");
  const translateMessage = useServerMessage();

  return (
    <Alert variant="destructive">
      <AlertTitle>{t("attention")}</AlertTitle>
      <AlertDescription>
        {translateMessage(error.message)}
        {retry && (
          <Button variant="outline" onClick={retry}>
            {t("retry")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function Loading() {
  const t = useTranslations("feedback");

  return (
    <p role="status" className="p-8 text-muted-foreground">
      {t("loading")}
    </p>
  );
}
