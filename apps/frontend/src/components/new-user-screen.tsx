"use client";

import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/use-workspace";
import { UserEditor } from "@/components/user-editor";
import { Loading, RequestError } from "@/components/request-feedback";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function NewUserScreen() {
  const me = useMe();
  const router = useRouter();

  if (me.error) return <RequestError error={me.error} />;
  if (!me.data) return <Loading />;
  if (!me.data.permissions.includes("configure"))
    return (
      <Alert variant="destructive">
        <AlertTitle>Administrator access required</AlertTitle>
        <AlertDescription>Your account cannot manage users.</AlertDescription>
      </Alert>
    );

  return (
    <section className="flex flex-col gap-8">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">
          Workspace / User management
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">New user</h1>
      </header>
      <UserEditor close={() => router.push("/users")} />
    </section>
  );
}
