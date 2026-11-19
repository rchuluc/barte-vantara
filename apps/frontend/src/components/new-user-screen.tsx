"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMe } from "@/hooks/use-workspace";
import { UserEditor } from "@/components/user-editor";
import { Loading, RequestError } from "@/components/request-feedback";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function NewUserScreen() {
  const t = useTranslations("ui");
  const me = useMe();
  const router = useRouter();

  if (me.error) return <RequestError error={me.error} />;
  if (!me.data) return <Loading />;
  if (!me.data.permissions.includes("configure"))
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("adminRequired")}</AlertTitle>
        <AlertDescription>{t("cannotManageUsers")}</AlertDescription>
      </Alert>
    );

  return (
    <section className="flex flex-col gap-8">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("userBreadcrumb")}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("newUser")}
        </h1>
      </header>
      <UserEditor close={() => router.push("/users")} />
    </section>
  );
}
