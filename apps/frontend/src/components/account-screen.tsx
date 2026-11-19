"use client";

import { useTranslations } from "next-intl";
import { useMe } from "@/hooks/use-workspace";
import { useTenant } from "@/components/workspace-provider";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading, RequestError } from "@/components/request-feedback";

export function AccountScreen({ profile = false }: { profile?: boolean }) {
  const t = useTranslations("account");
  const c = useTranslations("ui");
  const me = useMe();
  const tenant = useTenant();

  if (me.error)
    return (
      <RequestError
        error={me.error}
        retry={() => {
          void me.refetch();
        }}
      />
    );
  if (!me.data) return <Loading />;
  if (profile && me.data.permissions.includes("configure"))
    return <p role="alert">{t("adminHint")}</p>;

  const user = me.data;

  return (
    <section className="flex flex-col gap-8">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">
          {tenant.name} / {profile ? t("profile") : t("overview")}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {profile
            ? t("profile")
            : t("welcome", { name: user.display_name || user.email })}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {profile ? t("profileDescription") : t("overviewDescription")}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
          <CardDescription>
            {t("connected", { name: tenant.name })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">
                {t("displayName")}
              </dt>
              <dd className="mt-1 break-words font-medium">
                {user.display_name || t("notSet")}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("email")}</dt>
              <dd className="mt-1 break-all font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("status")}</dt>
              <dd className="mt-2">
                <Badge variant="secondary">
                  {user.active ? t("active") : t("inactive")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("roles")}</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <Badge key={role} variant="outline">
                    {c.has(`rolesList.${role}`) ? c(`rolesList.${role}`) : role}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
          {profile && (
            <div className="flex flex-col gap-5 border-t border-border pt-6">
              <h2 className="font-medium">{t("scopes")}</h2>
              <dl className="flex flex-col gap-4">
                {[
                  [
                    t("permissions"),
                    user.permissions.map((permission) =>
                      c.has(`permissions.${permission}`)
                        ? c(`permissions.${permission}`)
                        : permission,
                    ),
                  ],
                  [t("units"), user.unitIds],
                  [t("accounts"), user.bankAccountIds],
                  [
                    t("approvals"),
                    user.approvalScopes.map(
                      (scope) =>
                        `${scope.unit_id}: ${c.has(`permissions.${scope.permission}`) ? c(`permissions.${scope.permission}`) : scope.permission}`,
                    ),
                  ],
                ].map(([label, values]) => (
                  <div key={String(label)}>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words">
                      {(values as string[]).join(", ") || t("none")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">{t("contact")}</p>
        </CardFooter>
      </Card>
    </section>
  );
}
