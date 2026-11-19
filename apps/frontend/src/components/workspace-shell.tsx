"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LocaleSelector } from "@/components/locale-selector";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  UserRound,
  Users,
  FileSpreadsheet,
  Building2,
  Landmark,
} from "lucide-react";
import { useMe, useLogout } from "@/hooks/use-workspace";
import { useTenant } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Loading, RequestError } from "@/components/request-feedback";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("workspace");
  const tenant = useTenant();
  const me = useMe();
  const logout = useLogout();
  const pathname = usePathname();
  const router = useRouter();

  if (me.error)
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-4 p-8">
        <RequestError
          error={me.error}
          retry={() => {
            void me.refetch();
          }}
        />
        <Button asChild>
          <Link href="/login">{t("returnToLogin")}</Link>
        </Button>
      </main>
    );
  if (!me.data) return <Loading />;

  const admin = me.data.permissions.includes("configure");
  const links = [
    { path: "dashboard", label: t("overview"), icon: LayoutDashboard },
    { path: "imports", label: t("imports"), icon: FileSpreadsheet },
    {
      path: "reconciliation",
      label: t("reconciliation"),
      icon: FileSpreadsheet,
    },
    ...(admin
      ? [
          { path: "business-units", label: t("units"), icon: Building2 },
          { path: "bank-accounts", label: t("accounts"), icon: Landmark },
        ]
      : []),
    admin
      ? { path: "users", label: t("users"), icon: Users }
      : { path: "profile", label: t("profile"), icon: UserRound },
  ];

  return (
    <div className="workspace-grid h-dvh overflow-hidden">
      <a href="#main-content" className="skip-link">
        {t("skip")}
      </a>
      <aside className="flex min-h-0 flex-col gap-4 overflow-hidden border-b border-border bg-card p-4 lg:border-r lg:border-b-0">
        <Link
          href="/dashboard"
          className="text-2xl font-semibold tracking-tight"
        >
          {tenant.name}
          <span className="text-primary" aria-hidden="true">
            .
          </span>
        </Link>
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("label")}
          </p>
          <nav
            aria-label={t("label")}
            className="hidden flex-col gap-1 lg:flex"
          >
            {links.map(({ path, label, icon: Icon }) => (
              <Button
                key={path}
                asChild
                variant={
                  pathname.split("/").includes(path) ? "secondary" : "ghost"
                }
                className="justify-start"
              >
                <Link
                  href={`/${path}`}
                  aria-current={
                    pathname.split("/").includes(path) ? "page" : undefined
                  }
                >
                  <Icon data-icon="inline-start" aria-hidden="true" />
                  {label}
                </Link>
              </Button>
            ))}
          </nav>
          <div className="lg:hidden">
            <NativeSelect
              aria-label={t("page")}
              value={
                links.find(({ path }) => pathname.split("/").includes(path))
                  ?.path ?? "dashboard"
              }
              onChange={(event) => router.push(`/${event.target.value}`)}
            >
              {links.map(({ path, label }) => (
                <NativeSelectOption key={path} value={path}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-3">
          <LocaleSelector />
          <div className="hidden min-w-0 lg:block">
            <p className="truncate font-medium">
              {me.data.display_name || me.data.email}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {me.data.email}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {admin ? t("administrator") : t("member")}
            </p>
          </div>
          {logout.error && <RequestError error={logout.error} />}
          <Button
            variant="outline"
            className="justify-start"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut data-icon="inline-start" aria-hidden="true" />
            {logout.isPending ? t("signingOut") : t("signOut")}
          </Button>
        </div>
      </aside>
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-0 min-w-0 overflow-auto p-6 lg:p-10"
      >
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
