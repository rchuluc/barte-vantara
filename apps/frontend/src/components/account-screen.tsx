"use client";

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
    return (
      <p role="alert">
        Your account details are available on Overview. Use User management to
        manage workspace members.
      </p>
    );

  const user = me.data;

  return (
    <section className="mx-auto flex min-h-[70dvh] max-w-2xl flex-col justify-center gap-8">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">
          {tenant.name} / {profile ? "My profile" : "Overview"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {profile
            ? "My profile"
            : `Welcome, ${user.display_name || user.email}`}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {profile
            ? "Your account and workspace access."
            : "You’re in the right place. Here’s your workspace identity."}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>Connected to {tenant.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Display name</dt>
              <dd className="mt-1 break-words font-medium">
                {user.display_name || "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email address</dt>
              <dd className="mt-1 break-all font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Account status</dt>
              <dd className="mt-2">
                <Badge variant="secondary">
                  {user.active ? "Active" : "Inactive"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Roles</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <Badge key={role} variant="outline">
                    {role}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
          {profile && (
            <div className="flex flex-col gap-5 border-t border-border pt-6">
              <h2 className="font-medium">Access scopes</h2>
              <dl className="flex flex-col gap-4">
                {[
                  ["Permissions", user.permissions],
                  ["Business units", user.unitIds],
                  ["Bank accounts", user.bankAccountIds],
                  [
                    "Approval scopes",
                    user.approvalScopes.map(
                      (scope) => `${scope.unit_id}: ${scope.permission}`,
                    ),
                  ],
                ].map(([label, values]) => (
                  <div key={String(label)}>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words">
                      {(values as string[]).join(", ") || "None assigned"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            Contact your administrator to update your details or access.
          </p>
        </CardFooter>
      </Card>
    </section>
  );
}
