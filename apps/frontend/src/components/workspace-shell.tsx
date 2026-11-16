"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  UserRound,
  Users,
  FileSpreadsheet,
} from "lucide-react";
import { useMe, useLogout } from "@/hooks/use-workspace";
import { useTenant } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Loading, RequestError } from "@/components/request-feedback";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const tenant = useTenant();
  const me = useMe();
  const logout = useLogout();
  const pathname = usePathname();

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
          <Link href="/login">Return to sign in</Link>
        </Button>
      </main>
    );
  if (!me.data) return <Loading />;

  const admin = me.data.permissions.includes("configure");
  const links = [
    { path: "dashboard", label: "Overview", icon: LayoutDashboard },
    { path: "imports", label: "Data imports", icon: FileSpreadsheet },
    admin
      ? { path: "users", label: "User management", icon: Users }
      : { path: "profile", label: "My profile", icon: UserRound },
  ];

  return (
    <div className="workspace-grid min-h-dvh">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="flex flex-col gap-8 border-b border-border bg-card p-6 lg:border-r lg:border-b-0">
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
            Workspace
          </p>
          <nav
            aria-label="Workspace"
            className="flex flex-wrap gap-2 lg:flex-col"
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
        </div>
        <div className="mt-auto flex flex-col gap-4 border-t border-border pt-6">
          <div className="min-w-0">
            <p className="font-medium break-words">
              {me.data.display_name || me.data.email}
            </p>
            <p className="text-sm break-all text-muted-foreground">
              {me.data.email}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {admin ? "Workspace administrator" : "Workspace member"}
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
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className="min-w-0 p-6 lg:p-12">
        {children}
      </main>
    </div>
  );
}
