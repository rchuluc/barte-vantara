"use client";

import { useState } from "react";
import { Plus, Users } from "lucide-react";
import {
  useMe,
  useUsers,
  useSaveUser,
  useDeactivateUser,
} from "@/hooks/use-workspace";
import type { User } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { UserEditor } from "@/components/user-editor";
import { Loading, RequestError } from "@/components/request-feedback";

export function UsersScreen() {
  const me = useMe();

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
  if (!me.data.permissions.includes("configure"))
    return (
      <Alert variant="destructive">
        <AlertTitle>Administrator access required</AlertTitle>
        <AlertDescription>
          Your account cannot manage users. Contact your workspace
          administrator.
        </AlertDescription>
      </Alert>
    );

  return <UserManagement actorId={me.data.id} />;
}

function UserManagement({ actorId }: { actorId: string }) {
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<User | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<User | null>(null);
  const [notice, setNotice] = useState("");
  const users = useUsers(offset);
  const save = useSaveUser();
  const deactivate = useDeactivateUser();

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            Workspace / Administration
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            User management
          </h1>
          <p className="mt-3 text-muted-foreground">
            Manage the people and permissions in your workspace.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditor("new");
            setNotice("");
          }}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add user
        </Button>
      </header>
      {notice && <p role="status">{notice}</p>}
      {editor && (
        <UserEditor
          key={editor === "new" ? "new" : editor.id}
          user={editor === "new" ? undefined : editor}
          close={(saved) => {
            setEditor(null);
            if (saved) setNotice("User saved.");
          }}
        />
      )}
      {confirmation && (
        <Alert>
          <AlertTitle>Deactivate {confirmation.email}?</AlertTitle>
          <AlertDescription>
            This removes workspace access. You can reactivate this user later.
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                variant="destructive"
                disabled={deactivate.isPending}
                onClick={() =>
                  deactivate.mutate(confirmation.id, {
                    onSuccess: () => {
                      setConfirmation(null);
                      setNotice("User deactivated.");
                    },
                  })
                }
              >
                {deactivate.isPending
                  ? "Deactivating…"
                  : "Confirm deactivation"}
              </Button>
              <Button
                variant="outline"
                disabled={deactivate.isPending}
                onClick={() => setConfirmation(null)}
              >
                Cancel deactivation
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {deactivate.error && <RequestError error={deactivate.error} />}
      {save.error && <RequestError error={save.error} />}
      {users.error ? (
        <RequestError
          error={users.error}
          retry={() => {
            void users.refetch();
          }}
        />
      ) : !users.data ? (
        <Loading />
      ) : (
        <>
          {users.data.length === 0 ? (
            <Alert>
              <Users aria-hidden="true" />
              <AlertTitle>No users on this page</AlertTitle>
              <AlertDescription>
                Add a user or return to the previous page.
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {users.data.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-5 p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                      {user.display_name || user.email}
                      {user.id === actorId && " (you)"}
                    </p>
                    <p className="mt-1 text-sm break-all text-muted-foreground">
                      {user.email}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={user.active ? "secondary" : "outline"}>
                        {user.active ? "Active" : "Inactive"}
                      </Badge>
                      {user.roles.map((role) => (
                        <Badge key={role} variant="outline">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={user.id === actorId}
                      aria-label={`Edit ${user.email}`}
                      onClick={() => setEditor(user)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        user.id === actorId ||
                        save.isPending ||
                        deactivate.isPending
                      }
                      aria-label={`${user.active ? "Deactivate" : "Reactivate"} ${user.email}`}
                      onClick={() => {
                        if (user.active) {
                          deactivate.reset();
                          setConfirmation(user);
                        } else
                          save.mutate(
                            { id: user.id, body: { active: true } },
                            { onSuccess: () => setNotice("User reactivated.") },
                          );
                      }}
                    >
                      {user.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <nav
            aria-label="User pages"
            className="flex items-center justify-between gap-3"
          >
            <Button
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(offset - 20)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {offset / 20 + 1}
            </span>
            <Button
              variant="outline"
              disabled={users.data.length < 20}
              onClick={() => setOffset(offset + 20)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
